const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const pool = require('../db');
const mailer = require('../mailer');

const VALID_STATUSES = ['pending','completed','rejected'];
const TYPE_LABELS = { current:'Current Account', savings:'Savings Account', crypto:'Crypto Account' };
const DEFAULT_CRYPTO = { BTC:'1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf9n', ETH:'0x742d35Cc6634C0532925a3b844Bc454e4438f44e', USDT:'TN3W8e4BKMBK4K3nKzMr4jGxQMm3cVKgXj' };

async function adminOnly(req, res, next) {
  const { rows } = await pool.query(`SELECT is_admin FROM users WHERE id=$1`, [req.user.userId]);
  if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

async function logActivity(userId, action, details={}, adminId=null) {
  try { await pool.query(`INSERT INTO activity_log (id,user_id,admin_id,action,details) VALUES ($1,$2,$3,$4,$5)`, [uuidv4(), userId, adminId, action, JSON.stringify(details)]); } catch(e) {}
}

function mapTxn(t) {
  return { id:t.id, accountId:t.account_id, type:t.type, amount:parseFloat(t.amount), currency:t.currency, description:t.description, reference:t.reference, counterparty:t.counterparty, toIban:t.to_iban, senderCountry:t.sender_country, recipientCountry:t.recipient_country, status:t.status, date:t.date };
}

// GET /api/admin/clients
router.get('/clients', auth, adminOnly, async (req, res) => {
  const { rows: users } = await pool.query(`SELECT * FROM users ORDER BY created_at`);
  const { rows: accounts } = await pool.query(`SELECT * FROM accounts`);
  const clients = users.map(u => ({
    id: u.id, username: u.username, firstName: u.first_name, lastName: u.last_name,
    email: u.email, isAdmin: u.is_admin, blocked: u.blocked,
    mustChangePassword: u.must_change_password, createdAt: u.created_at,
    accounts: accounts.filter(a => a.user_id === u.id).map(a => ({
      id: a.id, type: a.type, label: a.label, currency: a.currency,
      balance: parseFloat(a.balance), iban: a.iban,
    })),
  }));
  return res.json(clients);
});

// POST /api/admin/clients
router.post('/clients', auth, adminOnly, async (req, res) => {
  const { username, password, firstName, lastName, email, isAdmin } = req.body;
  if (!username||!password||!firstName||!lastName||!email) return res.status(400).json({ error: 'All fields required' });
  const { rows: existing } = await pool.query(`SELECT id FROM users WHERE username=$1`, [username.toLowerCase().trim()]);
  if (existing.length) return res.status(409).json({ error: 'Username already exists' });

  const userId = `usr_${uuidv4().slice(0,8)}`;
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO users (id,username,password_hash,first_name,last_name,email,is_admin,must_change_password,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW())`,
      [userId, username.toLowerCase().trim(), hash, firstName, lastName, email, !!isAdmin]);

    const accountDefs = Array.isArray(req.body.accounts) && req.body.accounts.length > 0 ? req.body.accounts
      : [{type:'current',currency:'GBP',balance:0},{type:'savings',currency:'GBP',balance:0},{type:'crypto',currency:null,balance:0}];

    const createdAccounts = [];
    for (let idx = 0; idx < accountDefs.length; idx++) {
      const def = accountDefs[idx];
      const type = def.type || 'current';
      const isCrypto = type === 'crypto';
      const bal = parseFloat(def.balance)||0;
      const accId = `acc_${uuidv4().slice(0,8)}`;
      const suffix = Math.floor(Math.random()*90000000+10000000);

      if (isCrypto) {
        await client.query(`INSERT INTO accounts (id,user_id,type,label,currency,balance,crypto_addresses) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [accId, userId, type, TYPE_LABELS[type], null, 0, JSON.stringify(def.cryptoAddresses||DEFAULT_CRYPTO)]);
      } else {
        await client.query(`INSERT INTO accounts (id,user_id,type,label,currency,iban,account_number,sort_code,balance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [accId, userId, type, TYPE_LABELS[type], def.currency||'GBP', `GI75 TNBK ${String(idx).padStart(4,'0')} 0${suffix}`, String(suffix), '56-00-20', bal]);
        if (bal > 0) {
          await client.query(`INSERT INTO transactions (id,account_id,type,amount,currency,description,reference,counterparty,status,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
            [uuidv4(), accId, 'credit', bal, def.currency||'GBP', 'Opening balance', `OPEN-${Date.now()}`, 'Trusted Novus Bank', 'completed']);
        }
      }

      if (Array.isArray(def.history)) {
        for (const h of def.history) {
          const amt = parseFloat(h.amount);
          if (!amt||amt<=0) continue;
          await client.query(`INSERT INTO transactions (id,account_id,type,amount,currency,description,reference,counterparty,status,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [uuidv4(), accId, h.type==='debit'?'debit':'credit', amt, def.currency||'GBP', h.description||'Transfer', h.reference||`HIST-${Date.now()}`, h.counterparty||'Unknown', VALID_STATUSES.includes(h.status)?h.status:'completed', h.date||new Date().toISOString()]);
        }
      }
      createdAccounts.push({ id: accId, type, label: TYPE_LABELS[type] });
    }

    await client.query('COMMIT');
    const { rows: adminRows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
    const adminUser = adminRows[0];
    mailer.notifyClientRegistered({ firstName, lastName, username, email, accounts: createdAccounts }, `${adminUser?.first_name} ${adminUser?.last_name}`).catch(()=>{});
    await logActivity(userId, 'client_registered', { username }, req.user.userId);
    return res.status(201).json({ message: 'Client registered', client: { id:userId, username, firstName, lastName, email, accounts:createdAccounts } });
  } catch(e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'Registration failed' });
  } finally { client.release(); }
});

// PATCH /api/admin/clients/:id
router.patch('/clients/:id', auth, adminOnly, async (req, res) => {
  const { firstName, lastName, email } = req.body;
  await pool.query(`UPDATE users SET first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name), email=COALESCE($3,email) WHERE id=$4`,
    [firstName||null, lastName||null, email||null, req.params.id]);
  await logActivity(req.params.id, 'profile_updated_by_admin', {}, req.user.userId);
  return res.json({ message: 'Client updated' });
});

// PATCH /api/admin/clients/:id/block
router.patch('/clients/:id/block', auth, adminOnly, async (req, res) => {
  if (req.params.id === req.user.userId) return res.status(400).json({ error: 'Cannot block yourself' });
  const { rows } = await pool.query(`UPDATE users SET blocked = NOT blocked WHERE id=$1 RETURNING blocked, first_name, last_name`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Client not found' });
  const { blocked, first_name, last_name } = rows[0];
  const { rows: adminRows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
  const adminUser = adminRows[0];
  mailer.notifyAccountBlocked(`${first_name} ${last_name}`, blocked, `${adminUser?.first_name} ${adminUser?.last_name}`).catch(()=>{});
  await logActivity(req.params.id, blocked?'account_blocked':'account_unblocked', {}, req.user.userId);
  return res.json({ message: blocked?'Client blocked':'Client unblocked', blocked });
});

// PATCH /api/admin/clients/:id/reset-password
router.patch('/clients/:id/reset-password', auth, adminOnly, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword||newPassword.length<8) return res.status(400).json({ error: 'Min. 8 characters' });
  const hash = await bcrypt.hash(newPassword, 10);
  const { rows } = await pool.query(`UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2 RETURNING first_name, last_name, username`, [hash, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Client not found' });
  const { rows: adminRows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
  const adminUser = adminRows[0];
  mailer.notifyPasswordResetByAdmin(rows[0], `${adminUser?.first_name} ${adminUser?.last_name}`).catch(()=>{});
  await logActivity(req.params.id, 'password_reset_by_admin', {}, req.user.userId);
  return res.json({ message: 'Password reset' });
});

// DELETE /api/admin/clients/:id
router.delete('/clients/:id', auth, adminOnly, async (req, res) => {
  if (req.params.id === req.user.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Client not found' });
  return res.json({ message: 'Client deleted' });
});

// POST /api/admin/credit
router.post('/credit', auth, adminOnly, async (req, res) => {
  const { accountId, amount, description, currency } = req.body;
  if (!accountId||!amount) return res.status(400).json({ error: 'accountId and amount required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)||parsed<=0) return res.status(400).json({ error: 'Invalid amount' });
  const { rows } = await pool.query(`UPDATE accounts SET balance=balance+$1 WHERE id=$2 RETURNING *, (SELECT first_name||' '||last_name FROM users WHERE id=user_id) as client_name`, [parsed, accountId]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
  const acc = rows[0];
  const txnId = uuidv4();
  await pool.query(`INSERT INTO transactions (id,account_id,type,amount,currency,description,reference,counterparty,status,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [txnId, accountId, 'credit', parsed, acc.currency||currency||'GBP', description||'Manual credit by bank', `ADM-CR-${Date.now()}`, 'Trusted Novus Bank', 'completed']);
  const { rows: adminRows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
  const adminUser = adminRows[0];
  mailer.notifyAdminCredit(acc.client_name, parsed, acc.currency||'GBP', description, `${adminUser?.first_name} ${adminUser?.last_name}`).catch(()=>{});
  await logActivity(acc.user_id, 'admin_credit', { amount: parsed, accountId, description }, req.user.userId);
  const { rows: txnRows } = await pool.query(`SELECT * FROM transactions WHERE id=$1`, [txnId]);
  return res.status(201).json({ message: 'Credited', transaction: mapTxn(txnRows[0]), newBalance: parseFloat(acc.balance) });
});

// POST /api/admin/debit
router.post('/debit', auth, adminOnly, async (req, res) => {
  const { accountId, amount, description, currency } = req.body;
  if (!accountId||!amount) return res.status(400).json({ error: 'accountId and amount required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)||parsed<=0) return res.status(400).json({ error: 'Invalid amount' });
  const { rows: accRows } = await pool.query(`SELECT * FROM accounts WHERE id=$1`, [accountId]);
  if (!accRows[0]) return res.status(404).json({ error: 'Account not found' });
  if (parseFloat(accRows[0].balance) < parsed) return res.status(422).json({ error: 'Insufficient funds' });
  await pool.query(`UPDATE accounts SET balance=balance-$1 WHERE id=$2`, [parsed, accountId]);
  const txnId = uuidv4();
  await pool.query(`INSERT INTO transactions (id,account_id,type,amount,currency,description,reference,counterparty,status,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [txnId, accountId, 'debit', parsed, accRows[0].currency||currency||'GBP', description||'Manual debit by bank', `ADM-DB-${Date.now()}`, 'Trusted Novus Bank', 'completed']);
  const { rows: adminRows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
  const adminUser = adminRows[0];
  const { rows: userRows } = await pool.query(`SELECT first_name, last_name FROM users WHERE id=$1`, [accRows[0].user_id]);
  const clientName = userRows[0] ? `${userRows[0].first_name} ${userRows[0].last_name}` : accountId;
  mailer.notifyAdminDebit(clientName, parsed, accRows[0].currency||'GBP', description, `${adminUser?.first_name} ${adminUser?.last_name}`).catch(()=>{});
  await logActivity(accRows[0].user_id, 'admin_debit', { amount: parsed, accountId, description }, req.user.userId);
  const { rows: txnRows } = await pool.query(`SELECT * FROM transactions WHERE id=$1`, [txnId]);
  return res.status(201).json({ message: 'Debited', transaction: mapTxn(txnRows[0]), newBalance: parseFloat(accRows[0].balance) - parsed });
});

// PATCH /api/admin/transactions/:id/status
router.patch('/transactions/:id/status', auth, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const { rows } = await pool.query(`UPDATE transactions SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Transaction not found' });
  return res.json({ message: 'Status updated', transaction: mapTxn(rows[0]) });
});

// PATCH /api/admin/transactions/:id/date
router.patch('/transactions/:id/date', auth, adminOnly, async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid date' });
  const { rows } = await pool.query(`UPDATE transactions SET date=$1 WHERE id=$2 RETURNING *`, [parsed.toISOString(), req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Transaction not found' });
  return res.json({ message: 'Date updated', transaction: mapTxn(rows[0]) });
});

// GET /api/admin/accounts/:id/transactions
router.get('/accounts/:id/transactions', auth, adminOnly, async (req, res) => {
  const { rows: accRows } = await pool.query(`SELECT * FROM accounts WHERE id=$1`, [req.params.id]);
  if (!accRows[0]) return res.status(404).json({ error: 'Account not found' });
  const { rows: userRows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [accRows[0].user_id]);
  const { page=1, limit=50, type, search } = req.query;
  let q = `SELECT * FROM transactions WHERE account_id=$1`;
  const params = [req.params.id];
  if (type && ['credit','debit'].includes(type)) { q+=` AND type=$${params.length+1}`; params.push(type); }
  if (search) { q+=` AND (description ILIKE $${params.length+1} OR counterparty ILIKE $${params.length+1})`; params.push(`%${search}%`); }
  q+=` ORDER BY date DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(Number(limit), (Number(page)-1)*Number(limit));
  const { rows } = await pool.query(q, params);
  const { rows: cnt } = await pool.query(`SELECT COUNT(*) FROM transactions WHERE account_id=$1`, [req.params.id]);
  const acc = accRows[0];
  const user = userRows[0];
  return res.json({
    account: { id:acc.id, label:acc.label, type:acc.type, currency:acc.currency, balance:parseFloat(acc.balance), iban:acc.iban },
    client: user ? { id:user.id, firstName:user.first_name, lastName:user.last_name, username:user.username } : null,
    transactions: rows.map(mapTxn),
    pagination: { total: parseInt(cnt[0].count), page: Number(page), limit: Number(limit), pages: Math.ceil(parseInt(cnt[0].count)/Number(limit)) }
  });
});

// GET /api/admin/activity
router.get('/activity', auth, adminOnly, async (req, res) => {
  const { userId, limit=100, page=1 } = req.query;
  let q = `SELECT a.*, u.first_name||' '||u.last_name as user_name, adm.first_name||' '||adm.last_name as admin_name FROM activity_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN users adm ON adm.id=a.admin_id`;
  const params = [];
  if (userId) { q+=` WHERE a.user_id=$1`; params.push(userId); }
  q+=` ORDER BY a.date DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(Number(limit), (Number(page)-1)*Number(limit));
  const { rows } = await pool.query(q, params);
  const { rows: cnt } = await pool.query(`SELECT COUNT(*) FROM activity_log${userId?' WHERE user_id=$1':''}`, userId?[userId]:[]);
  return res.json({ log: rows.map(e => ({ id:e.id, userId:e.user_id, adminId:e.admin_id, action:e.action, details:e.details, date:e.date, userName:e.user_name, adminName:e.admin_name })), pagination: { total: parseInt(cnt[0].count), page: Number(page), limit: Number(limit) } });
});

// GET /api/admin/accounts/:id/export-csv
router.get('/accounts/:id/export-csv', (req, res, next) => {
  if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  next();
}, auth, adminOnly, async (req, res) => {
  const { rows: accRows } = await pool.query(`SELECT * FROM accounts WHERE id=$1`, [req.params.id]);
  if (!accRows[0]) return res.status(404).json({ error: 'Account not found' });
  const { rows } = await pool.query(`SELECT * FROM transactions WHERE account_id=$1 ORDER BY date DESC`, [req.params.id]);
  const header = 'Date,Type,Description,Counterparty,Amount,Currency,Status,Reference';
  const csvRows = rows.map(t => [
    new Date(t.date).toLocaleDateString('en-GB'),
    t.type, `"${(t.description||'').replace(/"/g,'""')}"`,
    `"${(t.counterparty||'').replace(/"/g,'""')}"`,
    t.amount, t.currency||'', t.status||'', t.reference||''
  ].join(','));
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition',`attachment; filename="account-${req.params.id}.csv"`);
  return res.send([header,...csvRows].join('\n'));
});

module.exports = router;
