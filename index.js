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

const nodes = [
  {
    name: "main",
    host: process.env.LAVALINK_HOST,
    port: Number(process.env.LAVALINK_PORT),
    auth: process.env.LAVALINK_PASSWORD,
    secure: process.env.LAVALINK_SECURE === "true"
  }
];

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  nodes
);

shoukaku.on("ready", (name) => {
  console.log(`${name} Lavalink connected`);
});

shoukaku.on("error", (name, error) => {
  console.error(error);
});

const queue = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play music")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("Song")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

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

client.once("ready", () => {
  console.log(`${client.user.tag} online`);
});

async function playNext(guildId) {

  const serverQueue = queue.get(guildId);

  if (!serverQueue) return;

  if (serverQueue.songs.length === 0) {
    serverQueue.player.destroy();
    queue.delete(guildId);
    return;
  }

  const track = serverQueue.songs[0];

  await serverQueue.player.playTrack({
    track: track.encoded
  });

  serverQueue.textChannel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Now Playing")
        .setDescription(track.info.title)
        .setColor("Green")
    ]
  });
}

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  const voice = interaction.member.voice.channel;

  if (!voice) {
    return interaction.reply("Join voice channel first");
  }

  let serverQueue = queue.get(interaction.guild.id);

  if (interaction.commandName === "play") {

    const query = interaction.options.getString("query");

    try {

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

        player.on("end", () => {

          serverQueue.songs.shift();

          if (serverQueue.songs.length > 0) {
            playNext(interaction.guild.id);
          } else {
            player.destroy();
            queue.delete(interaction.guild.id);
          }
        });
      }

      const node = shoukaku.nodes.get("main");

      const result = await node.rest.resolve(query);

      if (!result.tracks.length) {
        return interaction.reply("No results");
      }

      const track = result.tracks[0];

      serverQueue.songs.push(track);

      await interaction.reply(`Added: ${track.info.title}`);

      if (serverQueue.songs.length === 1) {
        playNext(interaction.guild.id);
      }

    } catch (err) {
      console.error(err);
      interaction.reply("Error");
    }
  }

  if (interaction.commandName === "skip") {

    if (!serverQueue)
      return interaction.reply("Nothing playing");

    serverQueue.songs.shift();

    if (serverQueue.songs.length > 0) {
      playNext(interaction.guild.id);
    } else {
      serverQueue.player.destroy();
      queue.delete(interaction.guild.id);
    }

    interaction.reply("Skipped");
  }

  if (interaction.commandName === "stop") {

    if (!serverQueue)
      return interaction.reply("Nothing playing");

    serverQueue.songs = [];

    serverQueue.player.destroy();

    queue.delete(interaction.guild.id);

    interaction.reply("Stopped");
  }
});

client.login(process.env.TOKEN);
