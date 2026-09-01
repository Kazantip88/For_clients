const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../db');

router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM accounts WHERE user_id=$1`, [req.user.userId]);
  return res.json(rows.map(a => ({
    id: a.id, userId: a.user_id, type: a.type, label: a.label,
    currency: a.currency, iban: a.iban, accountNumber: a.account_number,
    sortCode: a.sort_code, balance: parseFloat(a.balance),
    cryptoAddresses: a.crypto_addresses,
  })));
});

router.get('/:id', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM accounts WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
  const a = rows[0];
  return res.json({ id: a.id, userId: a.user_id, type: a.type, label: a.label, currency: a.currency, iban: a.iban, accountNumber: a.account_number, sortCode: a.sort_code, balance: parseFloat(a.balance), cryptoAddresses: a.crypto_addresses });
});

router.get('/:id/transactions', auth, async (req, res) => {
  const { rows: accRows } = await pool.query(`SELECT * FROM accounts WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.userId]);
  if (!accRows[0]) return res.status(404).json({ error: 'Account not found' });
  const { page=1, limit=20, type } = req.query;
  let q = `SELECT * FROM transactions WHERE account_id=$1`;
  const params = [req.params.id];
  if (type && ['credit','debit'].includes(type)) { q += ` AND type=$2`; params.push(type); }
  q += ` ORDER BY date DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(Number(limit), (Number(page)-1)*Number(limit));
  const { rows } = await pool.query(q, params);
  const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM transactions WHERE account_id=$1`, [req.params.id]);
  const total = parseInt(countRows[0].count);
  return res.json({ transactions: rows.map(mapTxn), pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total/Number(limit)) } });
});

function mapTxn(t) {
  return { id: t.id, accountId: t.account_id, type: t.type, amount: parseFloat(t.amount), currency: t.currency, description: t.description, reference: t.reference, counterparty: t.counterparty, toIban: t.to_iban, senderCountry: t.sender_country, recipientCountry: t.recipient_country, status: t.status, date: t.date };
}

module.exports = router;
