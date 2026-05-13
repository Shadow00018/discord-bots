require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const { Shoukaku, Connectors } = require("shoukaku");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

/* ---------------- LAVALINK ---------------- */

const nodes = [
  {
    name: "main",
    url: process.env.LAVALINK_URL,
    auth: process.env.LAVALINK_PASSWORD
  }
];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes);

/* ---------------- QUEUE ---------------- */

const queue = new Map();

/* ---------------- COMMANDS ---------------- */

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play music")
    .addStringOption(o =>
      o.setName("query").setDescription("Song name or URL").setRequired(true)
    ),

  new SlashCommandBuilder().setName("queue").setDescription("Show queue"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

/* ---------------- REGISTER COMMANDS ---------------- */

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("Commands registered");
  } catch (err) {
    console.error(err);
  }
})();

/* ---------------- READY ---------------- */

client.once("ready", () => {
  console.log(`${client.user.tag} online`);
});

/* ---------------- BUTTONS ---------------- */

function buttons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pause").setLabel("Pause").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("resume").setLabel("Resume").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("skip").setLabel("Skip").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("stop").setLabel("Stop").setStyle(ButtonStyle.Danger)
  );
}

/* ---------------- PLAY FUNCTION ---------------- */

async function playNext(guildId) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return;

  const track = serverQueue.songs.shift();
  if (!track) return;

  serverQueue.player.playTrack({ track: track.encoded });

  serverQueue.textChannel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Now Playing")
        .setDescription(track.info.title)
        .setColor("Green")
    ],
    components: [buttons()]
  });
}

/* ---------------- INTERACTIONS ---------------- */

client.on("interactionCreate", async (interaction) => {

  if (interaction.isButton()) {
    const serverQueue = queue.get(interaction.guild.id);
    if (!serverQueue) return;

    if (interaction.customId === "pause") {
      serverQueue.player.setPaused(true);
      return interaction.reply({ content: "Paused", ephemeral: true });
    }

    if (interaction.customId === "resume") {
      serverQueue.player.setPaused(false);
      return interaction.reply({ content: "Resumed", ephemeral: true });
    }

    if (interaction.customId === "skip") {
      serverQueue.player.stopTrack();
      return interaction.reply({ content: "Skipped", ephemeral: true });
    }

    if (interaction.customId === "stop") {
      serverQueue.songs = [];
      serverQueue.player.destroy();
      queue.delete(interaction.guild.id);
      return interaction.reply({ content: "Stopped", ephemeral: true });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const voice = interaction.member.voice.channel;
  if (!voice) return interaction.reply("Join a voice channel first");

  let serverQueue = queue.get(interaction.guild.id);

  /* ---------------- PLAY ---------------- */

  if (interaction.commandName === "play") {
    const query = interaction.options.getString("query");

    if (!serverQueue) {
      const player = await shoukaku.joinVoiceChannel({
        guildId: interaction.guild.id,
        channelId: voice.id,
        shardId: 0
      });

      serverQueue = {
        player,
        songs: [],
        textChannel: interaction.channel
      };

      queue.set(interaction.guild.id, serverQueue);
    }

    const result = await shoukaku.search(query);

    if (!result.tracks.length)
      return interaction.reply("No results found");

    serverQueue.songs.push(result.tracks[0]);

    interaction.reply(`Added: ${result.tracks[0].info.title}`);

    if (serverQueue.songs.length === 1) {
      playNext(interaction.guild.id);
    }
  }

  /* ---------------- QUEUE ---------------- */

  if (interaction.commandName === "queue") {
    const serverQueue = queue.get(interaction.guild.id);

    if (!serverQueue || !serverQueue.songs.length)
      return interaction.reply("Queue empty");

    const list = serverQueue.songs
      .map((s, i) => `${i + 1}. ${s.info.title}`)
      .join("\n");

    interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Queue")
          .setDescription(list)
          .setColor("Blue")
      ]
    });
  }

  /* ---------------- CONTROLS ---------------- */

  const serverQueue = queue.get(interaction.guild.id);

  if (!serverQueue) return;

  if (interaction.commandName === "pause")
    serverQueue.player.setPaused(true), interaction.reply("Paused");

  if (interaction.commandName === "resume")
    serverQueue.player.setPaused(false), interaction.reply("Resumed");

  if (interaction.commandName === "skip")
    serverQueue.player.stopTrack(), interaction.reply("Skipped");

  if (interaction.commandName === "stop") {
    serverQueue.songs = [];
    serverQueue.player.destroy();
    queue.delete(interaction.guild.id);
    interaction.reply("Stopped");
  }
});

client.login(process.env.TOKEN);
