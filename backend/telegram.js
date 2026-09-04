// telegram.js — Secure Telegram notifications
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function send(message) {
  if (!BOT_TOKEN || !ALLOWED_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ALLOWED_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) console.error('Telegram error:', data.description);
  } catch(e) {
    console.error('Telegram send failed:', e.message);
  }
}

function now() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow' });
}

module.exports = {
  notifyLogin: (user, ip) => send(
    `🔑 <b>Login</b>\n👤 ${user.firstName} ${user.lastName} (@${user.username})\n🌐 IP: ${ip||'unknown'}\n🕐 ${now()}`
  ),
  notifyPasswordChanged: (user) => send(
    `🔒 <b>Password Changed</b>\n👤 ${user.firstName} ${user.lastName} (@${user.username})\n🕐 ${now()}`
  ),
  notifyPasswordResetByAdmin: (user, adminName) => send(
    `🔑 <b>Password Reset by Admin</b>\n👤 Client: ${user.firstName} ${user.lastName}\n👮 Admin: ${adminName}\n🕐 ${now()}`
  ),
  notifyTransfer: (user, amount, currency, toName, toIban) => send(
    `💸 <b>Transfer Sent</b>\n👤 ${user.firstName} ${user.lastName} (@${user.username})\n💰 ${amount} ${currency} → ${toName}\n🏦 ${toIban}\n🕐 ${now()}`
  ),
  notifyAdminCredit: (clientName, amount, currency, description, adminName) => send(
    `➕ <b>Admin Credit</b>\n👤 ${clientName}\n💰 +${amount} ${currency}\n📝 ${description||'—'}\n👮 ${adminName}\n🕐 ${now()}`
  ),
  notifyAdminDebit: (clientName, amount, currency, description, adminName) => send(
    `➖ <b>Admin Debit</b>\n👤 ${clientName}\n💰 -${amount} ${currency}\n📝 ${description||'—'}\n👮 ${adminName}\n🕐 ${now()}`
  ),
  notifyClientRegistered: (client, adminName) => send(
    `👤 <b>New Client Registered</b>\n📛 ${client.firstName} ${client.lastName}\n🔤 @${client.username}\n📧 ${client.email}\n💳 Accounts: ${client.accounts?.length||0}\n👮 By: ${adminName}\n🕐 ${now()}`
  ),
  notifyAccountBlocked: (clientName, blocked, adminName) => send(
    `${blocked?'🚫':'✅'} <b>Account ${blocked?'Blocked':'Unblocked'}</b>\n👤 ${clientName}\n👮 By: ${adminName}\n🕐 ${now()}`
  ),
  notifyAddTransaction: (clientName, type, amount, currency, description, adminName) => send(
    `${type==='credit'?'⬇':'⬆'} <b>Transaction Added</b>\n👤 ${clientName}\n💰 ${amount} ${currency}\n📝 ${description||'—'}\n👮 ${adminName}\n🕐 ${now()}`
  ),
};
