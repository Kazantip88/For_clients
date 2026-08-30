// routes/accounts.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { accounts, transactions } = require('../db');

// GET /api/accounts — all accounts for current user
router.get('/', auth, (req, res) => {
  const userAccounts = accounts.filter(a => a.userId === req.user.userId);
  return res.json(userAccounts);
});

// GET /api/accounts/:id — single account detail
router.get('/:id', auth, (req, res) => {
  const account = accounts.find(
    a => a.id === req.params.id && a.userId === req.user.userId
  );
  if (!account) return res.status(404).json({ error: 'Account not found' });
  return res.json(account);
});

// GET /api/accounts/:id/transactions — transactions for an account
router.get('/:id/transactions', auth, (req, res) => {
  const account = accounts.find(
    a => a.id === req.params.id && a.userId === req.user.userId
  );
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const { page = 1, limit = 20, type } = req.query;
  let txns = transactions.filter(t => t.accountId === req.params.id);

  if (type && ['credit', 'debit'].includes(type)) {
    txns = txns.filter(t => t.type === type);
  }

  // Sort newest first
  txns.sort((a, b) => new Date(b.date) - new Date(a.date));

  const total = txns.length;
  const offset = (Number(page) - 1) * Number(limit);
  const paginated = txns.slice(offset, offset + Number(limit));

  return res.json({
    transactions: paginated,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

module.exports = router;
