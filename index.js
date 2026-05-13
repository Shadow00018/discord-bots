require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');

const play = require('play-dl');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const queues = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Song name / YouTube / Spotify URL')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show queue'),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause music'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume music'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip song'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop music'),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set volume')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('1-200')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay'),

  new SlashCommandBuilder()
    .setName('247')
    .setDescription('Toggle 24/7 mode'),

  new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Get lyrics')
]
.map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );

  console.log('Commands registered');
})();

client.once('ready', () => {
  console.log(`${client.user.tag} online`);
});

function createButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pause')
      .setLabel('Pause')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('resume')
      .setLabel('Resume')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId('skip')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('stop')
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
  );
}

async function playSong(guild, song) {
  const queue = queues.get(guild.id);

  if (!song) {

    if (!queue.stay) {
      queue.connection.destroy();
      queues.delete(guild.id);
    }

    return;
  }

  try {

    const stream = await play.stream(song.url);

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    resource.volume.setVolume(queue.volume / 100);

    queue.player.play(resource);

    const embed = new EmbedBuilder()
      .setTitle('Now Playing')
      .setDescription(`🎵 ${song.title}`)
      .setColor('#00ff99')
      .setThumbnail(song.thumbnail || null);

    queue.textChannel.send({
      embeds: [embed],
      components: [createButtons()]
    });

  } catch (err) {
    console.error(err);

    queue.songs.shift();

    playSong(guild, queue.songs[0]);
  }
}

async function getSong(query) {

  if (play.spotify_validate(query) === 'track') {

    const track = await play.spotify(query);

    return {
      title: track.name,
      url: `https://www.youtube.com/results?search_query=${track.name} ${track.artists[0].name}`,
      thumbnail: track.thumbnail.url
    };
  }

  const results = await play.search(query, { limit: 1 });

  if (!results.length) return null;

  return {
    title: results[0].title,
    url: results[0].url,
    thumbnail: results[0].thumbnails[0].url
  };
}

client.on('interactionCreate', async interaction => {

  if (interaction.isButton()) {

    const queue = queues.get(interaction.guild.id);

    if (!queue)
      return interaction.reply({
        content: 'Nothing playing',
        ephemeral: true
      });

    if (interaction.customId === 'pause') {
      queue.player.pause();
      return interaction.reply({
        content: '⏸️ Paused',
        ephemeral: true
      });
    }

    if (interaction.customId === 'resume') {
      queue.player.unpause();
      return interaction.reply({
        content: '▶️ Resumed',
        ephemeral: true
      });
    }

    if (interaction.customId === 'skip') {
      queue.player.stop();
      return interaction.reply({
        content: '⏭️ Skipped',
        ephemeral: true
      });
    }

    if (interaction.customId === 'stop') {

      queue.songs = [];

      queue.player.stop();

      queue.connection.destroy();

      queues.delete(interaction.guild.id);

      return interaction.reply({
        content: '🛑 Stopped',
        ephemeral: true
      });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const voiceChannel = interaction.member.voice.channel;

  if (
    interaction.commandName !== 'lyrics' &&
    !voiceChannel
  ) {
    return interaction.reply({
      content: 'Join a voice channel first',
      ephemeral: true
    });
  }

  let queue = queues.get(interaction.guild.id);

  switch (interaction.commandName) {

    case 'play': {

      await interaction.deferReply();

      const query = interaction.options.getString('query');

      const song = await getSong(query);

      if (!song)
        return interaction.editReply('Song not found');

      if (!queue) {

        const player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Pause
          }
        });

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator
        });

        await entersState(
          connection,
          VoiceConnectionStatus.Ready,
          30000
        );

        queue = {
          textChannel: interaction.channel,
          voiceChannel,
          connection,
          player,
          songs: [],
          volume: 100,
          autoplay: false,
          stay: false
        };

        queues.set(interaction.guild.id, queue);

        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, async () => {

          queue.songs.shift();

          if (
            queue.autoplay &&
            queue.songs.length === 0
          ) {

            const related = await play.search(song.title, {
              limit: 5
            });

            if (related[1]) {
              queue.songs.push({
                title: related[1].title,
                url: related[1].url,
                thumbnail: related[1].thumbnails[0].url
              });
            }
          }

          playSong(interaction.guild, queue.songs[0]);
        });
      }

      queue.songs.push(song);

      interaction.editReply(`✅ Added: ${song.title}`);

      if (queue.songs.length === 1) {
        playSong(interaction.guild, queue.songs[0]);
      }

      break;
    }

    case 'queue': {

      if (!queue || !queue.songs.length)
        return interaction.reply('Queue empty');

      const desc = queue.songs
        .map((s, i) => `${i + 1}. ${s.title}`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle('Music Queue')
        .setDescription(desc)
        .setColor('#0099ff');

      interaction.reply({ embeds: [embed] });

      break;
    }

    case 'pause':
      queue.player.pause();
      interaction.reply('⏸️ Paused');
      break;

    case 'resume':
      queue.player.unpause();
      interaction.reply('▶️ Resumed');
      break;

    case 'skip':
      queue.player.stop();
      interaction.reply('⏭️ Skipped');
      break;

    case 'stop':

      queue.songs = [];

      queue.player.stop();

      queue.connection.destroy();

      queues.delete(interaction.guild.id);

      interaction.reply('🛑 Stopped');

      break;

    case 'volume': {

      const amount =
        interaction.options.getInteger('amount');

      if (amount < 1 || amount > 200)
        return interaction.reply('Volume: 1-200');

      queue.volume = amount;

      const resource = queue.player.state.resource;

      if (resource?.volume) {
        resource.volume.setVolume(amount / 100);
      }

      interaction.reply(`🔊 Volume set to ${amount}%`);

      break;
    }

    case 'autoplay':

      queue.autoplay = !queue.autoplay;

      interaction.reply(
        `Autoplay ${queue.autoplay ? 'enabled' : 'disabled'}`
      );

      break;

    case '247':

      queue.stay = !queue.stay;

      interaction.reply(
        `24/7 mode ${queue.stay ? 'enabled' : 'disabled'}`
      );

      break;

    case 'lyrics': {

      interaction.reply(
        'Lyrics API example:\nhttps://some-random-api.com/lyrics?title=song'
      );

      break;
    }
  }
});

client.login(process.env.TOKEN);