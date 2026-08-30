// routes/admin.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const db = require('../db');
const mailer = require('../mailer');

const VALID_STATUSES = ['pending', 'completed', 'rejected'];
const TYPE_LABELS = { current:'Current Account', savings:'Savings Account', crypto:'Crypto Account' };
const DEFAULT_CRYPTO = { BTC:'1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf9n', ETH:'0x742d35Cc6634C0532925a3b844Bc454e4438f44e', USDT:'TN3W8e4BKMBK4K3nKzMr4jGxQMm3cVKgXj' };

function adminOnly(req, res, next) {
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user || !user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function logActivity(userId, action, details = {}, adminId = null) {
  if (!db.activityLog) return;
  db.activityLog.push({ id: require('crypto').randomUUID(), userId, adminId, action, details, date: new Date().toISOString() });
}

// ── GET /api/admin/clients ────────────────────────────────────────
router.get('/clients', auth, adminOnly, (req, res) => {
  const clients = db.users.map(u => ({
    id: u.id, username: u.username, firstName: u.firstName, lastName: u.lastName,
    email: u.email, isAdmin: !!u.isAdmin, blocked: !!u.blocked,
    mustChangePassword: !!u.mustChangePassword, createdAt: u.createdAt || null,
    accounts: db.accounts.filter(a => a.userId === u.id).map(a => ({
      id: a.id, type: a.type, label: a.label, currency: a.currency, balance: a.balance, iban: a.iban || null,
    })),
  }));
  return res.json(clients);
});

// ── POST /api/admin/clients ───────────────────────────────────────
router.post('/clients', auth, adminOnly, async (req, res) => {
  const { username, password, firstName, lastName, email, isAdmin } = req.body;
  if (!username || !password || !firstName || !lastName || !email) return res.status(400).json({ error: 'All fields are required' });
  if (db.users.find(u => u.username === username.toLowerCase().trim())) return res.status(409).json({ error: 'Username already exists' });

  const userId = `usr_${uuidv4().slice(0,8)}`;
  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = { id: userId, username: username.toLowerCase().trim(), passwordHash, firstName, lastName, email, isAdmin: !!isAdmin, mustChangePassword: true, createdAt: new Date().toISOString() };

  const accountDefs = Array.isArray(req.body.accounts) && req.body.accounts.length > 0 ? req.body.accounts
    : [{ type:'current', currency:'GBP', balance:0 }, { type:'savings', currency:'GBP', balance:0 }, { type:'crypto', currency:null, balance:0 }];

  const createdAccounts = accountDefs.map((def, idx) => {
    const suffix = Math.floor(Math.random() * 90000000 + 10000000);
    const type = def.type || 'current';
    const isCrypto = type === 'crypto';
    const bal = parseFloat(def.balance) || 0;
    const acc = { id:`acc_${uuidv4().slice(0,8)}`, userId, type, label: TYPE_LABELS[type]||'Account', currency: isCrypto ? null : (def.currency||'GBP'), balance: bal };
    if (isCrypto) { acc.cryptoAddresses = def.cryptoAddresses || DEFAULT_CRYPTO; }
    else { acc.iban = `GI75 TNBK ${String(idx).padStart(4,'0')} 0${suffix}`; acc.accountNumber = String(suffix); acc.sortCode = '56-00-20'; }
    if (bal > 0 && !isCrypto) {
      db.transactions.push({ id:uuidv4(), accountId:acc.id, type:'credit', amount:bal, currency:acc.currency, description:'Opening balance', reference:`OPEN-${Date.now()}`, counterparty:'Trusted Novus Bank', date:new Date().toISOString(), status:'completed' });
    }
    if (Array.isArray(def.history)) {
      def.history.forEach(h => {
        const txnAmount = parseFloat(h.amount);
        if (!txnAmount || txnAmount <= 0) return;
        db.transactions.push({ id:uuidv4(), accountId:acc.id, type:h.type==='debit'?'debit':'credit', amount:txnAmount, currency:acc.currency||'GBP', description:h.description||'Transfer', reference:h.reference||`HIST-${Date.now()}`, counterparty:h.counterparty||'Unknown', date:h.date||new Date().toISOString(), status: VALID_STATUSES.includes(h.status)?h.status:'completed' });
      });
    }
    return acc;
  });

  db.users.push(newUser);
  db.accounts.push(...createdAccounts);
  const adminUserR = db.users.find(u => u.id === req.user.userId);
  mailer.notifyClientRegistered({ firstName, lastName, username: newUser.username, email, accounts: createdAccounts }, adminUserR ? `${adminUserR.firstName} ${adminUserR.lastName}` : 'Admin');
  logActivity(userId, 'client_registered', { registeredBy: req.user.userId, username: newUser.username }, req.user.userId);
  return res.status(201).json({ message:'Client registered', client:{ id:userId, username:newUser.username, firstName, lastName, email, accounts:createdAccounts } });
});

// ── PATCH /api/admin/clients/:id ─────────────────────────────────
router.patch('/clients/:id', auth, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error:'Client not found' });
  const { firstName, lastName, email } = req.body;
  if (firstName) user.firstName = firstName;
  if (lastName)  user.lastName  = lastName;
  if (email)     user.email     = email;
  logActivity(user.id, 'profile_updated_by_admin', { firstName, lastName, email }, req.user.userId);
  return res.json({ message:'Client updated' });
});

// ── PATCH /api/admin/clients/:id/block ───────────────────────────
router.patch('/clients/:id/block', auth, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error:'Client not found' });
  if (user.id === req.user.userId) return res.status(400).json({ error:'Cannot block yourself' });
  user.blocked = !user.blocked;
  const adminUserB = db.users.find(u => u.id === req.user.userId);
  mailer.notifyAccountBlocked(`${user.firstName} ${user.lastName}`, user.blocked, adminUserB ? `${adminUserB.firstName} ${adminUserB.lastName}` : 'Admin');
  logActivity(user.id, user.blocked ? 'account_blocked' : 'account_unblocked', {}, req.user.userId);
  return res.json({ message: user.blocked ? 'Client blocked' : 'Client unblocked', blocked: user.blocked });
});

// ── PATCH /api/admin/clients/:id/reset-password ──────────────────
router.patch('/clients/:id/reset-password', auth, adminOnly, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error:'Password must be at least 8 characters' });
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error:'Client not found' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = true;
  const adminUserPW = db.users.find(u => u.id === req.user.userId);
  mailer.notifyPasswordResetByAdmin(user, adminUserPW ? `${adminUserPW.firstName} ${adminUserPW.lastName}` : 'Admin');
  logActivity(user.id, 'password_reset_by_admin', {}, req.user.userId);
  return res.json({ message:'Password reset successfully' });
});

// ── DELETE /api/admin/clients/:id ────────────────────────────────
router.delete('/clients/:id', auth, adminOnly, (req, res) => {
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'Client not found' });
  if (req.params.id === req.user.userId) return res.status(400).json({ error:'Cannot delete yourself' });
  db.users.splice(idx, 1);
  const toRemove = db.accounts.filter(a => a.userId === req.params.id).map(a => a.id);
  toRemove.forEach(aid => { const i = db.accounts.findIndex(a => a.id === aid); if (i !== -1) db.accounts.splice(i, 1); });
  return res.json({ message:'Client deleted' });
});

// ── POST /api/admin/credit ────────────────────────────────────────
router.post('/credit', auth, adminOnly, (req, res) => {
  const { accountId, amount, description, currency } = req.body;
  if (!accountId || !amount) return res.status(400).json({ error:'accountId and amount required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return res.status(400).json({ error:'Amount must be positive' });
  const account = db.accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error:'Account not found' });
  account.balance = parseFloat((account.balance + parsed).toFixed(2));
  const txn = { id:uuidv4(), accountId, type:'credit', amount:parsed, currency:account.currency||currency||'GBP', description:description||'Manual credit by bank', reference:`ADM-CR-${Date.now()}`, counterparty:'Trusted Novus Bank', date:new Date().toISOString(), status:'completed' };
  db.transactions.push(txn);
  const owner = db.users.find(u => u.id === account.userId);
  const adminUser = db.users.find(u => u.id === req.user.userId);
  mailer.notifyAdminCredit(owner ? `${owner.firstName} ${owner.lastName}` : accountId, parsed, account.currency || 'GBP', description, adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin');
  logActivity(account.userId, 'admin_credit', { amount:parsed, accountId, description }, req.user.userId);
  return res.status(201).json({ message:'Account credited', transaction:txn, newBalance:account.balance });
});

// ── POST /api/admin/debit ─────────────────────────────────────────
router.post('/debit', auth, adminOnly, (req, res) => {
  const { accountId, amount, description, currency } = req.body;
  if (!accountId || !amount) return res.status(400).json({ error:'accountId and amount required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return res.status(400).json({ error:'Amount must be positive' });
  const account = db.accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error:'Account not found' });
  if (account.balance < parsed) return res.status(422).json({ error:'Insufficient funds' });
  account.balance = parseFloat((account.balance - parsed).toFixed(2));
  const txn = { id:uuidv4(), accountId, type:'debit', amount:parsed, currency:account.currency||currency||'GBP', description:description||'Manual debit by bank', reference:`ADM-DB-${Date.now()}`, counterparty:'Trusted Novus Bank', date:new Date().toISOString(), status:'completed' };
  db.transactions.push(txn);
  const ownerD = db.users.find(u => u.id === account.userId);
  const adminUserD = db.users.find(u => u.id === req.user.userId);
  mailer.notifyAdminDebit(ownerD ? `${ownerD.firstName} ${ownerD.lastName}` : accountId, parsed, account.currency || 'GBP', description, adminUserD ? `${adminUserD.firstName} ${adminUserD.lastName}` : 'Admin');
  logActivity(account.userId, 'admin_debit', { amount:parsed, accountId, description }, req.user.userId);
  return res.status(201).json({ message:'Account debited', transaction:txn, newBalance:account.balance });
});

// ── PATCH /api/admin/transactions/:id/status ─────────────────────
router.patch('/transactions/:id/status', auth, adminOnly, (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error:`Status must be one of: ${VALID_STATUSES.join(', ')}` });
  const txn = db.transactions.find(t => t.id === req.params.id);
  if (!txn) return res.status(404).json({ error:'Transaction not found' });
  txn.status = status;
  return res.json({ message:'Status updated', transaction:txn });
});

// ── PATCH /api/admin/transactions/:id/date ───────────────────────
router.patch('/transactions/:id/date', auth, adminOnly, (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error:'date is required' });
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return res.status(400).json({ error:'Invalid date format' });
  const txn = db.transactions.find(t => t.id === req.params.id);
  if (!txn) return res.status(404).json({ error:'Transaction not found' });
  txn.date = parsed.toISOString();
  return res.json({ message:'Date updated', transaction:txn });
});

// ── PATCH /api/admin/transactions/:id/counterparty ───────────────
router.patch('/transactions/:id/counterparty', auth, adminOnly, (req, res) => {
  const { counterparty } = req.body;
  if (!counterparty) return res.status(400).json({ error:'counterparty is required' });
  const txn = db.transactions.find(t => t.id === req.params.id);
  if (!txn) return res.status(404).json({ error:'Transaction not found' });
  txn.counterparty = counterparty;
  return res.json({ message:'Counterparty updated', transaction:txn });
});

// ── GET /api/admin/accounts/:id/transactions ─────────────────────
router.get('/accounts/:id/transactions', auth, adminOnly, (req, res) => {
  const account = db.accounts.find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error:'Account not found' });
  const owner = db.users.find(u => u.id === account.userId);
  const { page=1, limit=50, type, search } = req.query;
  let txns = db.transactions.filter(t => t.accountId === req.params.id);
  if (type && ['credit','debit'].includes(type)) txns = txns.filter(t => t.type===type);
  if (search) {
    const q = search.toLowerCase();
    txns = txns.filter(t => t.description?.toLowerCase().includes(q) || t.counterparty?.toLowerCase().includes(q) || String(t.amount).includes(q));
  }
  txns.sort((a,b) => new Date(b.date) - new Date(a.date));
  const total = txns.length;
  const offset = (Number(page)-1) * Number(limit);
  const paginated = txns.slice(offset, offset + Number(limit));
  return res.json({ account:{ id:account.id, label:account.label, type:account.type, currency:account.currency, balance:account.balance, iban:account.iban||null }, client: owner ? { id:owner.id, firstName:owner.firstName, lastName:owner.lastName, username:owner.username } : null, transactions:paginated, pagination:{ total, page:Number(page), limit:Number(limit), pages:Math.ceil(total/Number(limit)) } });
});

// ── GET /api/admin/activity ───────────────────────────────────────
router.get('/activity', auth, adminOnly, (req, res) => {
  const { userId, limit=100, page=1 } = req.query;
  let log = [...(db.activityLog||[])];
  if (userId) log = log.filter(e => e.userId === userId);
  log.sort((a,b) => new Date(b.date) - new Date(a.date));
  const total = log.length;
  const offset = (Number(page)-1) * Number(limit);
  const paginated = log.slice(offset, offset + Number(limit));
  // Enrich with user names
  const enriched = paginated.map(e => {
    const user = db.users.find(u => u.id === e.userId);
    const admin = e.adminId ? db.users.find(u => u.id === e.adminId) : null;
    return { ...e, userName: user ? `${user.firstName} ${user.lastName}` : e.userId, adminName: admin ? `${admin.firstName} ${admin.lastName}` : null };
  });
  return res.json({ log: enriched, pagination:{ total, page:Number(page), limit:Number(limit), pages:Math.ceil(total/Number(limit)) } });
});

// ── GET /api/admin/accounts/:id/export-csv ───────────────────────
router.get('/accounts/:id/export-csv', (req, res, next) => {
  // Allow token via query param for direct browser downloads
  if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  next();
}, auth, adminOnly, (req, res) => {
  const account = db.accounts.find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error:'Account not found' });
  const txns = db.transactions.filter(t => t.accountId === req.params.id).sort((a,b) => new Date(b.date)-new Date(a.date));
  const header = 'Date,Type,Description,Counterparty,Amount,Currency,Status,Reference';
  const rows = txns.map(t => [
    new Date(t.date).toLocaleDateString('en-GB'),
    t.type, `"${(t.description||'').replace(/"/g,'""')}"`,
    `"${(t.counterparty||'').replace(/"/g,'""')}"`,
    t.amount, t.currency||'', t.status||'', t.reference||''
  ].join(','));
  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="account-${req.params.id}.csv"`);
  return res.send(csv);
});

module.exports = router;
