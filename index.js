require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, Events
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// ── Helper: check if member has a role ────────────────────────────
function hasMod(member) {
  return (
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.roles.cache.has(process.env.MOD_ROLE_ID)
  );
}

function hasMember(member) {
  return (
    member.roles.cache.has(process.env.MEMBER_ROLE_ID) ||
    member.roles.cache.has(process.env.MOD_ROLE_ID) // mods can also post
  );
}

// ── Register /post slash command ──────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('post')
    .setDescription('Create a marketplace post')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('✅ Slash commands registered.');
});

client.on(Events.InteractionCreate, async interaction => {

  // ── /post command → check role → show modal ───────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'post') {

    if (!hasMember(interaction.member)) {
      return interaction.reply({
        content: `❌ You need the <@&${process.env.MEMBER_ROLE_ID}> role to create a post.`,
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('post_modal')
      .setTitle('Create a Marketplace Post');

    const titleInput = new TextInputBuilder()
      .setCustomId('post_title')
      .setLabel('Post Title')
      .setPlaceholder('e.g. Your Post Title Goes Here')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId('post_desc')
      .setLabel('Description')
      .setPlaceholder('Your Post Description Goes Here')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const priceInput = new TextInputBuilder()
      .setCustomId('post_price')
      .setLabel('Price')
      .setPlaceholder('e.g. Your Price in USD or $R')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const imageInput = new TextInputBuilder()
      .setCustomId('post_image')
      .setLabel('Image URL (optional)')
      .setPlaceholder('Paste a direct image link, e.g. https://i.imgur.com/abc.jpg')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(priceInput),
      new ActionRowBuilder().addComponents(imageInput),
    );

    return interaction.showModal(modal);
  }

  // ── Post modal submitted ───────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'post_modal') {
    await interaction.deferReply({ ephemeral: true });

    const title = interaction.fields.getTextInputValue('post_title');
    const desc  = interaction.fields.getTextInputValue('post_desc');
    const price = interaction.fields.getTextInputValue('post_price');
    const image = interaction.fields.getTextInputValue('post_image');

    const embed = new EmbedBuilder()
      .setTitle(`🏷️ ${title}`)
      .setDescription(desc)
      .addFields({ name: '💰 Price', value: price, inline: true })
      .setFooter({ text: `Posted by ${interaction.user.tag} (${interaction.user.id})` })
      .setColor(0x5865F2)
      .setTimestamp();

    if (image) embed.setImage(image);

    const approvalChannel = await client.channels.fetch(process.env.APPROVAL_CHANNEL_ID);

    const approveBtn = new ButtonBuilder()
      .setCustomId(`approve_${interaction.user.id}`)
      .setLabel('✅ Approve')
      .setStyle(ButtonStyle.Success);

    const rejectBtn = new ButtonBuilder()
      .setCustomId(`reject_${interaction.user.id}`)
      .setLabel('❌ Reject')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

    await approvalChannel.send({
      content: `📬 New post from <@${interaction.user.id}> awaiting approval — <@&${process.env.MOD_ROLE_ID}>`,
      embeds: [embed],
      components: [row]
    });

    await interaction.editReply({ content: '✅ Your post has been submitted for approval! You will receive a DM once it is reviewed.' });
  }

  // ── Approve button ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
    const posterId = interaction.customId.split('_')[1];

    if (!hasMod(interaction.member)) {
      return interaction.reply({
        content: `❌ Only members with the <@&${process.env.MOD_ROLE_ID}> role can approve posts.`,
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    const originalEmbed = interaction.message.embeds[0];
    const postChannel = await client.channels.fetch(process.env.POST_CHANNEL_ID);

    const chatBtn = new ButtonBuilder()
      .setCustomId(`chat_${posterId}`)
      .setLabel('💬 Chat with Seller')
      .setStyle(ButtonStyle.Primary);

    const deleteBtn = new ButtonBuilder()
      .setCustomId(`delete_${posterId}`)
      .setLabel('🗑️ Delete Post')
      .setStyle(ButtonStyle.Secondary);

    const reportBtn = new ButtonBuilder()
      .setCustomId(`report_${posterId}`)
      .setLabel('🚩 Report Post')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(chatBtn, deleteBtn, reportBtn);

    const postedMsg = await postChannel.send({ embeds: [originalEmbed], components: [row] });

    // DM the poster
    try {
      const poster = await client.users.fetch(posterId);
      await poster.send(`✅ **Your post has been approved!**\nYou can view it here: ${postedMsg.url}`);
    } catch {}

    // Disable approval buttons so mods can't double-approve
    await interaction.message.edit({ components: [] });
    await interaction.message.reply({
      content: `✅ Approved and published by <@${interaction.user.id}>`
    });
  }

  // ── Reject button → show reason modal ─────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('reject_')) {
    const posterId = interaction.customId.split('_')[1];

    if (!hasMod(interaction.member)) {
      return interaction.reply({
        content: `❌ Only members with the <@&${process.env.MOD_ROLE_ID}> role can reject posts.`,
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`reject_reason_${posterId}`)
      .setTitle('Reason for Rejection');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reject_reason')
      .setLabel('Explain why this post is being rejected')
      .setPlaceholder('e.g. Post violates rule #3 – no digital goods. Please resubmit with a physical item.')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  }

  // ── Reject reason modal submitted ─────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_reason_')) {
    const posterId = interaction.customId.split('_')[2];
    const reason = interaction.fields.getTextInputValue('reject_reason');

    await interaction.deferUpdate();

    try {
      const poster = await client.users.fetch(posterId);
      await poster.send(
        `❌ **Your marketplace post was rejected.**\n\n**Reason:** ${reason}\n\nFeel free to fix the issue and submit a new post.`
      );
    } catch {}

    await interaction.message.edit({ components: [] });
    await interaction.message.reply({
      content: `❌ Rejected by <@${interaction.user.id}>.\n**Reason:** ${reason}`
    });
  }

  // ── Chat with Seller button → check role → show modal ─────────
  if (interaction.isButton() && interaction.customId.startsWith('chat_')) {

    if (!hasMember(interaction.member)) {
      return interaction.reply({
        content: `❌ You need the <@&${process.env.MEMBER_ROLE_ID}> role to chat with sellers.`,
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`chat_reply_${interaction.message.id}`)
      .setTitle('Message the Seller');

    const msgInput = new TextInputBuilder()
      .setCustomId('chat_message')
      .setLabel('Your opening message')
      .setPlaceholder('e.g. Hi! Is this item still available? Can you do $200?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
    return interaction.showModal(modal);
  }

  // ── Chat modal submitted → open thread ────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('chat_reply_')) {
    const msgId = interaction.customId.split('_')[2];
    await interaction.deferReply({ ephemeral: true });

    try {
      const postChannel = await client.channels.fetch(process.env.POST_CHANNEL_ID);
      const postMsg = await postChannel.messages.fetch(msgId);

      // Re-use existing thread if it already exists
      let thread = postMsg.thread;
      if (!thread) {
        thread = await postMsg.startThread({
          name: `Chat: ${postMsg.embeds[0]?.title?.replace('🏷️ ', '') || 'Post Discussion'}`,
          autoArchiveDuration: 1440
        });
      }

      const openingMsg = interaction.fields.getTextInputValue('chat_message');
      await thread.send(`<@${interaction.user.id}> says:\n\n${openingMsg}`);
      await interaction.editReply({ content: `💬 Message sent! Continue chatting here: ${thread.url}` });
    } catch (e) {
      console.error(e);
      await interaction.editReply({ content: '❌ Something went wrong opening the thread. Please try again.' });
    }
  }

  // ── Delete Post button ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('delete_')) {
    const posterId = interaction.customId.split('_')[1];

    const isMod    = hasMod(interaction.member);
    const isPoster = interaction.user.id === posterId;

    if (!isMod && !isPoster) {
      return interaction.reply({
        content: '❌ Only the original poster or a moderator can delete this post.',
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    if (interaction.message.thread) {
      try { await interaction.message.thread.delete(); } catch {}
    }

    // DM poster if a mod deleted it (not the poster themselves)
    if (isMod && !isPoster) {
      try {
        const poster = await client.users.fetch(posterId);
        await poster.send(`🗑️ Your marketplace post was removed by a moderator.`);
      } catch {}
    }

    await interaction.message.delete();
  }

  // ── Report Post button → show reason modal ─────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('report_')) {
    const modal = new ModalBuilder()
      .setCustomId(`report_reason_${interaction.message.id}`)
      .setTitle('Report this Post');

    const reasonInput = new TextInputBuilder()
      .setCustomId('report_reason')
      .setLabel('Why are you reporting this post?')
      .setPlaceholder('e.g. Seller is asking for payment outside the server / item is counterfeit.')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  }

  // ── Report reason modal submitted ──────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('report_reason_')) {
    const msgId = interaction.customId.split('_')[2];
    await interaction.deferReply({ ephemeral: true });

    const reason = interaction.fields.getTextInputValue('report_reason');
    const ticketChannel = await client.channels.fetch(process.env.TICKETS_CHANNEL_ID);

    //______ PORT just added ____________________
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    });


    // Fetch the original post embed to include in the report
    let embed = null;
    try {
      const postChannel = await client.channels.fetch(process.env.POST_CHANNEL_ID);
      const postMsg = await postChannel.messages.fetch(msgId);
      embed = postMsg.embeds[0] ?? null;
    } catch {}

    await ticketChannel.send({
      content: `🚩 **Post reported** by <@${interaction.user.id}> — <@&${process.env.MOD_ROLE_ID}> please review.\n\n**Reason:** ${reason}`,
      embeds: embed ? [embed] : [],
    });

    await interaction.editReply({ content: '🚩 Report submitted. Our moderators will look into it shortly.' });
  }

});

client.login(process.env.TOKEN);
