const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const pool = require('../db');
const mailer = require('../mailer');

async function logActivity(userId, action, details = {}) {
  try { await pool.query(`INSERT INTO activity_log (id,user_id,action,details) VALUES ($1,$2,$3,$4)`, [uuidv4(), userId, action, JSON.stringify(details)]); } catch(e) {}
}

router.post('/', auth, async (req, res) => {
  const { fromAccountId, toIban, toName, amount, reference, currency, senderCountry, recipientCountry } = req.body;
  if (!fromAccountId || !toIban || !toName || !amount) return res.status(400).json({ error: 'Missing required fields' });
  if (typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE`, [fromAccountId, req.user.userId]);
    const acc = rows[0];
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    if (acc.type === 'crypto') return res.status(400).json({ error: 'Cannot send from crypto account' });
    if (parseFloat(acc.balance) < amount) return res.status(422).json({ error: 'Insufficient funds' });

    await client.query(`UPDATE accounts SET balance=balance-$1 WHERE id=$2`, [amount, fromAccountId]);
    const txnId = uuidv4();
    const cur = acc.currency || currency || 'GBP';
    await client.query(`INSERT INTO transactions (id,account_id,type,amount,currency,description,reference,counterparty,to_iban,sender_country,recipient_country,status,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [txnId, fromAccountId, 'debit', amount, cur, reference||`Transfer to ${toName}`, `TRF-${Date.now()}`, toName, toIban, senderCountry||null, recipientCountry||null, 'completed']);
    await client.query('COMMIT');

    const { rows: userRows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
    const user = userRows[0];
    await logActivity(req.user.userId, 'transfer_sent', { amount, currency: cur, toName, toIban });
    if (user) mailer.notifyTransfer({ firstName: user.first_name, lastName: user.last_name, username: user.username }, amount, cur, toName, toIban).catch(() => {});

    const { rows: newAcc } = await pool.query(`SELECT balance FROM accounts WHERE id=$1`, [fromAccountId]);
    return res.status(201).json({ message: 'Transfer completed', newBalance: parseFloat(newAcc[0].balance) });
  } catch(e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'Transfer failed' });
  } finally { client.release(); }
});

router.get('/history', auth, async (req, res) => {
  const { rows: accs } = await pool.query(`SELECT id FROM accounts WHERE user_id=$1`, [req.user.userId]);
  const ids = accs.map(a => a.id);
  if (!ids.length) return res.json([]);
  const { rows } = await pool.query(`SELECT * FROM transactions WHERE account_id = ANY($1) ORDER BY date DESC LIMIT 50`, [ids]);
  return res.json(rows.map(t => ({ id:t.id, accountId:t.account_id, type:t.type, amount:parseFloat(t.amount), currency:t.currency, description:t.description, reference:t.reference, counterparty:t.counterparty, status:t.status, date:t.date, senderCountry:t.sender_country, recipientCountry:t.recipient_country })));
});

module.exports = router;
