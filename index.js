const express = require('express');
const app = express();
app.use(express.json());
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');

app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    bot: client.user ? client.user.tag : 'starting...',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const db = new Database('data.db');

// ================= DATABASE =================
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS balances (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0
  )
`,
).run();

const getBalance = db.prepare(`SELECT balance FROM balances WHERE user_id = ?`);

const upsertBalance = db.prepare(`
  INSERT INTO balances (user_id, balance)
  VALUES (?, ?)
  ON CONFLICT(user_id)
  DO UPDATE SET balance = balance + excluded.balance
`);

const setBalance = db.prepare(`
  INSERT INTO balances (user_id, balance)
  VALUES (?, ?)
  ON CONFLICT(user_id)
  DO UPDATE SET balance = excluded.balance
`);

const topBalances = db.prepare(`
  SELECT user_id, balance
  FROM balances
  ORDER BY balance DESC
  LIMIT 10
`);

// ================= UTIL =================
const toMoney = (n) => (n * 1000).toLocaleString('vi-VN') + ' đ';
const isAdmin = (id) => id === process.env.ADMIN_ID;

// ================= READY =================
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// ================= MESSAGE =================
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== process.env.CHANNEL_ID) return;

  const content = msg.content.trim();

  // ========= MONEY (self / other) =========
  if (content.startsWith('money')) {
    const user = msg.mentions.users.first() || msg.author;
    const row = getBalance.get(user.id);
    const balance = row ? row.balance : 0;

    const embed = new EmbedBuilder()
      .setColor('#f1c40f')
      .setTitle('💎 VÍ THƯỞNG')
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: '👤 Người dùng', value: `<@${user.id}>`, inline: true },
        { name: '💰 Số dư', value: `**${toMoney(balance)}**`, inline: true },
      )
      .setFooter({ text: 'Thư ký của aBin' })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // ========= TOP =========
  // ===== TOP ĐẠI GIA (XỊN XÒ) =====
  const topBalancesNoAdmin = db.prepare(`
  SELECT user_id, balance
  FROM balances
  WHERE user_id != ?
  ORDER BY balance DESC
  LIMIT 10
`);

  if (content === 'top') {
    // lấy top KHÔNG tính admin
    const rows = topBalancesNoAdmin.all(process.env.ADMIN_ID);
    if (!rows.length) return msg.reply('📭 Chưa có dữ liệu');

    const medals = ['🥇', '🥈', '🥉'];

    const desc = rows
      .map((r, i) => {
        const rank = i + 1;
        const medal = medals[i] || '🏅';

        return `**#${rank} ${medal} <@${r.user_id}>**\n` + `💰 Tài sản: **${toMoney(r.balance)}**`;
      })
      .join('\n\n');

    // avatar TOP 1 (không phải admin vì đã bị loại)
    const topUser = await client.users.fetch(rows[0].user_id).catch(() => null);

    const embed = new EmbedBuilder()
      .setColor('#f1c40f')
      .setTitle('🏆 BẢNG XẾP HẠNG ĐẠI GIA')
      .setDescription(desc)
      .setFooter({ text: 'Top người giàu nhất server' })
      .setTimestamp();

    if (topUser) {
      embed.setThumbnail(topUser.displayAvatarURL({ size: 256 }));
    }

    return msg.reply({ embeds: [embed] });
  }

  // ========= HELP =========
  if (content === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('📘 HƯỚNG DẪN SỬ DỤNG BOT')
      .setDescription(
        `
🧑 **LỆNH DÀNH CHO NGƯỜI DÙNG**
━━━━━━━━━━━━━━━━
💰 \`money\`  
→ Xem số dư của bạn  

👤 \`money @user\`  
→ Xem số dư của người khác  

🏆 \`top\`  
→ Bảng xếp hạng đại gia trong server  

👑 **LỆNH DÀNH CHO ADMIN**
━━━━━━━━━━━━━━━━
🤫 \`@user +4 / -2\`  
→ Cộng hoặc trừ tiền người dùng  

🧮 \`set @user 10\`  
→ Đặt lại số dư tuyệt đối  

♻️ \`reset @user\`  
→ Reset tiền về 0  

🎉 \`giveall 1\`  
→ Phát tiền cho toàn bộ người dùng  

💀 \`takeall 1\`  
→ Thu tiền toàn bộ người dùng  
`,
      )
      .setFooter({ text: '🤖 Thư ký của aBin' })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // ========= ADMIN ONLY =========
  if (!isAdmin(msg.author.id)) return;

  // @user +4 / -2
  let match = content.match(/^<@!?(\d+)>\s*([+-]\d+)$/);
  if (match) {
    const targetId = match[1];
    const amount = parseInt(match[2], 10);

    // cập nhật số dư
    upsertBalance.run(targetId, amount);

    const newBalance = getBalance.get(targetId)?.balance ?? 0;

    const moneyChange = (Math.abs(amount) * 1000).toLocaleString('vi-VN');
    const totalMoney = (newBalance * 1000).toLocaleString('vi-VN');

    // xác định loại giao dịch
    const isAdd = amount > 0;

    const targetUser = msg.mentions.users.first();

    const embed = new EmbedBuilder()
      .setColor(isAdd ? '#2ecc71' : '#e74c3c') // xanh / đỏ
      .setTitle(isAdd ? '💵 CỘNG TIỀN THÀNH CÔNG' : '💸 TRỪ TIỀN THÀNH CÔNG')
      .setThumbnail(targetUser ? targetUser.displayAvatarURL({ size: 256 }) : null)
      .addFields(
        { name: '👤 Người dùng', value: `<@${targetId}>`, inline: true },
        {
          name: isAdd ? '💰 Số tiền cộng' : '💸 Số tiền trừ',
          value: `**${isAdd ? '+' : '-'}${moneyChange} đ**`,
          inline: true,
        },
        {
          name: '🏦 Số dư mới',
          value: `**${totalMoney} đ**`,
          inline: false,
        },
      )
      .setFooter({ text: 'Thư ký của aBin' })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // set @user 10
  // ===== SET TIỀN =====
  match = content.match(/^set\s+<@!?(\d+)>\s+(\d+)$/);
  if (match) {
    const targetId = match[1];
    const newValue = parseInt(match[2]);

    const oldBalance = getBalance.get(targetId)?.balance ?? 0;
    setBalance.run(targetId, newValue);

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('🧮 SET SỐ DƯ')
      .setThumbnail(`https://cdn.discordapp.com/avatars/${targetId}/${msg.mentions.users.first()?.avatar}.png?size=256`)
      .addFields(
        { name: '👤 Người dùng', value: `<@${targetId}>`, inline: true },
        {
          name: '📉 Số dư cũ',
          value: `**${toMoney(oldBalance)}**`,
          inline: true,
        },
        {
          name: '📈 Số dư mới',
          value: `**${toMoney(newValue)}**`,
          inline: true,
        },
        {
          name: '🛠 Người thao tác',
          value: `<@${msg.author.id}>`,
          inline: false,
        },
      )
      .setFooter({ text: 'Thư ký của aBin' })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // reset @user
  match = content.match(/^reset\s+<@!?(\d+)>$/);
  if (match) {
    setBalance.run(match[1], 0);
    return msg.reply(`♻️ Đã reset tiền <@${match[1]}>`);
  }

  // giveall / takeall
  // ===== GIVEALL / TAKEALL =====
  match = content.match(/^(giveall|takeall)\s+(\d+)$/);
  if (match) {
    const type = match[1];
    const amount = parseInt(match[2]);
    const signedAmount = type === 'giveall' ? amount : -amount;
    const ADMIN_ID = String(process.env.ADMIN_ID);

    const countRow = db.prepare(`SELECT COUNT(*) AS count FROM balances WHERE user_id != ?`).get(ADMIN_ID);

    const count = countRow.count;

    if (count === 0) {
      return msg.reply('⚠️ Không có người dùng nào để cập nhật');
    }

    // 👉 cập nhật hàng loạt (SIÊU NHANH)
    db.prepare(
      `
    UPDATE balances
    SET balance = balance + ?
    WHERE user_id != ?
  `,
    ).run(signedAmount, ADMIN_ID);

    const embed = new EmbedBuilder()
      .setColor(type === 'giveall' ? '#2ecc71' : '#e74c3c')
      .setTitle(type === 'giveall' ? '🎉 PHÁT TIỀN TOÀN SERVER' : '💀 THU TIỀN TOÀN SERVER')
      .addFields(
        {
          name: '👥 Số người ảnh hưởng',
          value: `**${count} người**`,
          inline: true,
        },
        {
          name: type === 'giveall' ? '💰 Mỗi người nhận' : '💸 Mỗi người bị trừ',
          value: `**${toMoney(amount)}**`,
          inline: true,
        },
        {
          name: '🧮 Tổng giá trị',
          value: `**${toMoney(amount * count)}**`,
          inline: false,
        },
        {
          name: '🛠 Người thao tác',
          value: `<@${msg.author.id}>`,
          inline: false,
        },
      )
      .setFooter({ text: 'Thư ký của aBin' })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }
});

client.login(process.env.BOT_TOKEN);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🌐 API server running on port ${PORT}`);
});
