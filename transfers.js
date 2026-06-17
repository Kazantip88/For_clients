// routes/transfers.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { accounts, transactions, pendingTransfers } = require('../db');

// POST /api/transfers — initiate a transfer
router.post('/', auth, (req, res) => {
  const { fromAccountId, toIban, toName, amount, reference, currency } = req.body;

  // Validation
  if (!fromAccountId || !toIban || !toName || !amount) {
    return res.status(400).json({
      error: 'fromAccountId, toIban, toName, and amount are required',
    });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  const fromAccount = accounts.find(
    a => a.id === fromAccountId && a.userId === req.user.userId
  );
  if (!fromAccount) {
    return res.status(404).json({ error: 'Source account not found' });
  }

  if (fromAccount.type === 'crypto') {
    return res.status(400).json({ error: 'Cannot send from crypto account via SWIFT/SEPA' });
  }

  if (fromAccount.balance < amount) {
    return res.status(422).json({ error: 'Insufficient funds' });
  }

  // Deduct balance (in production this would be a DB transaction)
  fromAccount.balance = parseFloat((fromAccount.balance - amount).toFixed(2));

  const txn = {
    id: uuidv4(),
    accountId: fromAccountId,
    type: 'debit',
    amount,
    currency: fromAccount.currency || currency || 'GBP',
    description: reference || `Transfer to ${toName}`,
    reference: `TRF-${Date.now()}`,
    counterparty: toName,
    toIban,
    date: new Date().toISOString(),
    status: 'completed',
  };

  transactions.push(txn);

  return res.status(201).json({
    message: 'Transfer completed',
    transaction: txn,
    newBalance: fromAccount.balance,
  });
});

// GET /api/transfers/history — transfer history for user
router.get('/history', auth, (req, res) => {
  const userAccountIds = accounts
    .filter(a => a.userId === req.user.userId)
    .map(a => a.id);

  const history = transactions
    .filter(t => userAccountIds.includes(t.accountId))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 50);

  return res.json(history);
});

module.exports = router;
