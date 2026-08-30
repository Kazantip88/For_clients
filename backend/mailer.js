// mailer.js — Email notifications via Brevo SMTP
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_LOGIN,
    pass: process.env.SMTP_PASSWORD,
  },
});

const NOTIFY_TO   = process.env.NOTIFY_EMAIL;
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'noreply@trustednovusbank.gi';

async function send(subject, html) {
  if (!NOTIFY_TO || !process.env.SMTP_LOGIN) return;
  try {
    await transporter.sendMail({
      from: `"Trusted Novus Bank" <${NOTIFY_FROM}>`,
      to: NOTIFY_TO,
      subject,
      html,
    });
  } catch (e) {
    console.error('📧 Email notify failed:', e.message);
  }
}

function row(label, value) {
  return `<tr><td style="padding:8px 12px;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6">${label}</td><td style="padding:8px 12px;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6">${value}</td></tr>`;
}

function template(title, emoji, color, rows) {
  return `
  <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB">
    <div style="background:${color};padding:20px 24px;display:flex;align-items:center;gap:12px">
      <span style="font-size:28px">${emoji}</span>
      <div>
        <div style="color:white;font-size:16px;font-weight:700">${title}</div>
        <div style="color:rgba(255,255,255,.7);font-size:12px">Trusted Novus Bank · ${new Date().toLocaleString('en-GB')}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <div style="padding:12px 24px;background:#F9FAFB;text-align:center;font-size:11px;color:#9CA3AF">
      This is an automated notification from Trusted Novus Bank admin system.
    </div>
  </div>`;
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────

function notifyLogin(user, ip) {
  return send(
    `🔑 Login — ${user.firstName} ${user.lastName}`,
    template('Client Login', '🔑', '#1B4332',
      row('Client', `${user.firstName} ${user.lastName}`) +
      row('Username', `@${user.username}`) +
      row('Email', user.email) +
      row('IP Address', ip || 'unknown') +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyPasswordChanged(user) {
  return send(
    `🔒 Password Changed — ${user.firstName} ${user.lastName}`,
    template('Password Changed', '🔒', '#92400E',
      row('Client', `${user.firstName} ${user.lastName}`) +
      row('Username', `@${user.username}`) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyPasswordResetByAdmin(user, adminName) {
  return send(
    `🔑 Password Reset — ${user.firstName} ${user.lastName}`,
    template('Password Reset by Admin', '🔑', '#92400E',
      row('Client', `${user.firstName} ${user.lastName}`) +
      row('Username', `@${user.username}`) +
      row('Reset by', adminName) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyTransfer(user, amount, currency, toName, toIban) {
  return send(
    `💸 Transfer — ${amount} ${currency} by ${user.firstName} ${user.lastName}`,
    template('Transfer Sent', '💸', '#1E40AF',
      row('Client', `${user.firstName} ${user.lastName}`) +
      row('Username', `@${user.username}`) +
      row('Amount', `${amount} ${currency}`) +
      row('Recipient', toName) +
      row('IBAN', toIban) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyAdminCredit(clientName, amount, currency, description, adminName) {
  return send(
    `➕ Credit — ${amount} ${currency} to ${clientName}`,
    template('Admin Credit', '➕', '#166534',
      row('Client', clientName) +
      row('Amount', `+${amount} ${currency}`) +
      row('Description', description || '—') +
      row('By Admin', adminName) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyAdminDebit(clientName, amount, currency, description, adminName) {
  return send(
    `➖ Debit — ${amount} ${currency} from ${clientName}`,
    template('Admin Debit', '➖', '#991B1B',
      row('Client', clientName) +
      row('Amount', `-${amount} ${currency}`) +
      row('Description', description || '—') +
      row('By Admin', adminName) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyClientRegistered(client, adminName) {
  return send(
    `👤 New Client — ${client.firstName} ${client.lastName}`,
    template('New Client Registered', '👤', '#1B4332',
      row('Name', `${client.firstName} ${client.lastName}`) +
      row('Username', `@${client.username}`) +
      row('Email', client.email) +
      row('Accounts', `${client.accounts?.length || 0}`) +
      row('Registered by', adminName) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyAccountBlocked(clientName, blocked, adminName) {
  const color = blocked ? '#991B1B' : '#166534';
  const emoji = blocked ? '🚫' : '✅';
  const title = blocked ? 'Account Blocked' : 'Account Unblocked';
  return send(
    `${emoji} ${title} — ${clientName}`,
    template(title, emoji, color,
      row('Client', clientName) +
      row('Status', blocked ? 'BLOCKED' : 'UNBLOCKED') +
      row('By Admin', adminName) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

function notifyAddTransaction(clientName, type, amount, currency, description, adminName) {
  return send(
    `${type === 'credit' ? '⬇' : '⬆'} Transaction Added — ${amount} ${currency}`,
    template('Transaction Added by Admin', type === 'credit' ? '⬇' : '⬆', type === 'credit' ? '#166534' : '#92400E',
      row('Client', clientName) +
      row('Type', type === 'credit' ? 'Incoming' : 'Outgoing') +
      row('Amount', `${amount} ${currency}`) +
      row('Description', description || '—') +
      row('By Admin', adminName) +
      row('Time', new Date().toLocaleString('en-GB'))
    )
  );
}

module.exports = {
  notifyLogin, notifyPasswordChanged, notifyPasswordResetByAdmin,
  notifyTransfer, notifyAdminCredit, notifyAdminDebit,
  notifyClientRegistered, notifyAccountBlocked, notifyAddTransaction,
};
