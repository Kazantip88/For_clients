// routes/transfers.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const db = require('../db');
const mailer = require('../mailer');

function logActivity(userId, action, details = {}) {
  if (!db.activityLog) return;
  db.activityLog.push({ id: require('crypto').randomUUID(), userId, action, details, date: new Date().toISOString() });
}

router.post('/', auth, (req, res) => {
  const { fromAccountId, toIban, toName, amount, reference, currency, senderCountry, recipientCountry } = req.body;
  if (!fromAccountId || !toIban || !toName || !amount) return res.status(400).json({ error: 'fromAccountId, toIban, toName, and amount are required' });
  if (typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  const fromAccount = db.accounts.find(a => a.id === fromAccountId && a.userId === req.user.userId);
  if (!fromAccount) return res.status(404).json({ error: 'Source account not found' });
  if (fromAccount.type === 'crypto') return res.status(400).json({ error: 'Cannot send from crypto account' });
  if (fromAccount.balance < amount) return res.status(422).json({ error: 'Insufficient funds' });
  fromAccount.balance = parseFloat((fromAccount.balance - amount).toFixed(2));
  const txn = { id: uuidv4(), accountId: fromAccountId, type: 'debit', amount, currency: fromAccount.currency || currency || 'GBP', description: reference || `Transfer to ${toName}`, reference: `TRF-${Date.now()}`, counterparty: toName, toIban, senderCountry: senderCountry || null, recipientCountry: recipientCountry || null, date: new Date().toISOString(), status: 'completed' };
  db.transactions.push(txn);
  const user = db.users.find(u => u.id === req.user.userId);
  logActivity(req.user.userId, 'transfer_sent', { amount, currency: txn.currency, toName, toIban, accountId: fromAccountId });
  if (user) mailer.notifyTransfer(user, amount, txn.currency, toName, toIban);
  return res.status(201).json({ message: 'Transfer completed', transaction: txn, newBalance: fromAccount.balance });
});

router.get('/history', auth, (req, res) => {
  const userAccountIds = db.accounts.filter(a => a.userId === req.user.userId).map(a => a.id);
  const history = db.transactions.filter(t => userAccountIds.includes(t.accountId)).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 50);
  return res.json(history);
});

module.exports = router;
