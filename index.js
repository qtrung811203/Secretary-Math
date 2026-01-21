require('dotenv').config()
const { Client, GatewayIntentBits } = require('discord.js')
const { EmbedBuilder } = require('discord.js')
const Database = require('better-sqlite3')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

const db = new Database('data.db')

// init table
db.prepare(`
  CREATE TABLE IF NOT EXISTS balances (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0
  )
`).run()

const getBalance = db.prepare(`
  SELECT balance FROM balances WHERE user_id = ?
`)

const upsertBalance = db.prepare(`
  INSERT INTO balances (user_id, balance)
  VALUES (?, ?)
  ON CONFLICT(user_id)
  DO UPDATE SET balance = balance + excluded.balance
`)

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`)
})

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return
  if (msg.channel.id !== process.env.CHANNEL_ID) return

  const content = msg.content.trim()
  console.log(content)

  // ===== XEM TIỀN =====
if (content === 'money') {
  const row = getBalance.get(msg.author.id)
  const balance = row ? row.balance : 0
  const money = (balance * 1000).toLocaleString('vi-VN')

  const embed = new EmbedBuilder()
    .setColor('#f1c40f') // vàng kim
    .setTitle('💎 VÍ THƯỞNG CÁ NHÂN')
    .setThumbnail(msg.author.displayAvatarURL())
    .addFields(
      { name: '👤 Người dùng', value: `<@${msg.author.id}>`, inline: true },
      { name: '💰 Số dư', value: `**${money} đ**`, inline: true }
    )
    .setFooter({ text: 'Thư ký của aBin' })
    .setTimestamp()

  return msg.reply({ embeds: [embed] })
}



// ===== CHỈ ADMIN ĐƯỢC CHỈNH =====
if (msg.author.id !== process.env.ADMIN_ID) return

// format: @user +4 / -2
const match = content.match(/^<@!?(\d+)>\s*([+-]\d+)$/)
if (!match) return

const targetId = match[1]
const amount = parseInt(match[2], 10)

// cập nhật số dư
upsertBalance.run(targetId, amount)

const newBalance = getBalance.get(targetId)?.balance ?? 0

const moneyChange = (Math.abs(amount) * 1000).toLocaleString('vi-VN')
const totalMoney = (newBalance * 1000).toLocaleString('vi-VN')

// xác định loại giao dịch
const isAdd = amount > 0

const embed = new EmbedBuilder()
  .setColor(isAdd ? '#2ecc71' : '#e74c3c') // xanh / đỏ
  .setTitle(isAdd ? '💵 CỘNG TIỀN THÀNH CÔNG' : '💸 TRỪ TIỀN THÀNH CÔNG')
  .setThumbnail(
    `https://cdn.discordapp.com/avatars/${targetId}/${msg.mentions.users.first()?.avatar}.png?size=256`
  )
  .addFields(
    { name: '👤 Người dùng', value: `<@${targetId}>`, inline: true },
    {
      name: isAdd ? '💰 Số tiền cộng' : '💸 Số tiền trừ',
      value: `**${isAdd ? '+' : '-'}${moneyChange} đ**`,
      inline: true
    },
    {
      name: '🏦 Số dư mới',
      value: `**${totalMoney} đ**`,
      inline: false
    }
  )
  .setFooter({ text: 'Thư ký của aBin' })
  .setTimestamp()

return msg.reply({ embeds: [embed] })

})

client.login(process.env.BOT_TOKEN)
