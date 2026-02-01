require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const Database = require("better-sqlite3");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const db = new Database("data.db");

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
const toMoney = (n) => (n * 1000).toLocaleString("vi-VN") + " đ";
const isAdmin = (id) => id === process.env.ADMIN_ID;

// ================= READY =================
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// ================= MESSAGE =================
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== process.env.CHANNEL_ID) return;

  const content = msg.content.trim();

  // ========= MONEY (self / other) =========
  if (content.startsWith("money")) {
    const user = msg.mentions.users.first() || msg.author;
    const row = getBalance.get(user.id);
    const balance = row ? row.balance : 0;

    const embed = new EmbedBuilder()
      .setColor("#f1c40f")
      .setTitle("💎 VÍ THƯỞNG")
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "👤 Người dùng", value: `<@${user.id}>`, inline: true },
        { name: "💰 Số dư", value: `**${toMoney(balance)}**`, inline: true },
      )
      .setFooter({ text: "Thư ký của aBin" })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // ========= TOP =========
  if (content === "top") {
    const rows = topBalances.all();

    if (!rows.length) return msg.reply("📭 Chưa có dữ liệu");

    const desc = rows
      .map(
        (r, i) =>
          `**${i + 1}.** <@${r.user_id}> — 💰 **${toMoney(r.balance)}**`,
      )
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor("#9b59b6")
      .setTitle("🏆 TOP ĐẠI GIA")
      .setDescription(desc)
      .setFooter({ text: "Thư ký của aBin" })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // ========= HELP =========
  if (content === "help") {
    const embed = new EmbedBuilder()
      .setColor("#3498db")
      .setTitle("📘 HƯỚNG DẪN")
      .setDescription(
        `
**👤 Người dùng**
• \`money\`
• \`money @user\`
• \`top\`

**👑 Admin**
• \`@user +4 / -2\`
• \`set @user 10\`
• \`reset @user\`
• \`giveall 1\`
• \`takeall 1\`
`,
      )
      .setFooter({ text: "Thư ký của aBin" });

    return msg.reply({ embeds: [embed] });
  }

  // ========= ADMIN ONLY =========
  if (!isAdmin(msg.author.id)) return;

  // @user +4 / -2
  let match = content.match(/^<@!?(\d+)>\s*([+-]\d+)$/);
  if (match) {
    const targetId = match[1];
    const amount = parseInt(match[2]);
    upsertBalance.run(targetId, amount);

    const newBalance = getBalance.get(targetId)?.balance ?? 0;
    return msg.reply(
      `✅ <@${targetId}> ${amount > 0 ? "nhận" : "bị trừ"} **${toMoney(Math.abs(amount))}**\n🏦 Số dư: **${toMoney(newBalance)}**`,
    );
  }

  // set @user 10
  match = content.match(/^set\s+<@!?(\d+)>\s+(\d+)$/);
  if (match) {
    setBalance.run(match[1], parseInt(match[2]));
    return msg.reply(`🧮 Đã set tiền cho <@${match[1]}>`);
  }

  // reset @user
  match = content.match(/^reset\s+<@!?(\d+)>$/);
  if (match) {
    setBalance.run(match[1], 0);
    return msg.reply(`♻️ Đã reset tiền <@${match[1]}>`);
  }

  // giveall / takeall
  match = content.match(/^(giveall|takeall)\s+(\d+)$/);
  if (match) {
    const amount = parseInt(match[2]) * (match[1] === "giveall" ? 1 : -1);

    msg.guild.members.cache.forEach((m) => {
      if (!m.user.bot) upsertBalance.run(m.id, amount);
    });

    return msg.reply(
      `🎁 Đã ${match[1] === "giveall" ? "phát" : "thu"} tiền toàn server`,
    );
  }
});

client.login(process.env.BOT_TOKEN);
