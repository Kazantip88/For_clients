// routes/admin.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const { users, accounts, transactions } = require('../db');

// Simple admin check — first user (id=usr_001) or role=admin
function adminOnly(req, res, next) {
  const user = users.find(u => u.id === req.user.userId);
  if (!user || (!user.isAdmin && user.id !== 'usr_001')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ─── GET /api/admin/clients ─────────────────────────────────────
router.get('/clients', auth, adminOnly, (req, res) => {
  const clients = users.map(u => {
    const userAccounts = accounts.filter(a => a.userId === u.id);
    return {
      id: u.id,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      isAdmin: !!u.isAdmin,
      createdAt: u.createdAt || null,
      accounts: userAccounts.map(a => ({
        id: a.id,
        type: a.type,
        label: a.label,
        currency: a.currency,
        balance: a.balance,
        iban: a.iban || null,
      })),
    };
  });
  return res.json(clients);
});

// ─── POST /api/admin/clients ─────────────────────────────────────
// Register a new client
router.post('/clients', auth, adminOnly, async (req, res) => {
  const { username, password, firstName, lastName, email, isAdmin } = req.body;

  if (!username || !password || !firstName || !lastName || !email) {
    return res.status(400).json({ error: 'All fields are required: username, password, firstName, lastName, email' });
  }

  if (users.find(u => u.username === username.toLowerCase().trim())) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const userId = `usr_${uuidv4().slice(0, 8)}`;
  const passwordHash = await bcrypt.hash(password, 10);

  const newUser = {
    id: userId,
    username: username.toLowerCase().trim(),
    passwordHash,
    firstName,
    lastName,
    email,
    isAdmin: !!isAdmin,
    createdAt: new Date().toISOString(),
  };

  // Build accounts from request body or fall back to defaults
  const TYPE_LABELS = { current: 'Current Account', savings: 'Savings Account', crypto: 'Crypto Account' };
  const DEFAULT_CRYPTO_ADDRS = {
    BTC:  '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf9n',
    ETH:  '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    USDT: 'TN3W8e4BKMBK4K3nKzMr4jGxQMm3cVKgXj',
  };

  const accountDefs = Array.isArray(req.body.accounts) && req.body.accounts.length > 0
    ? req.body.accounts
    : [
        { type: 'current', currency: 'GBP', balance: 0 },
        { type: 'savings', currency: 'GBP', balance: 0 },
        { type: 'crypto',  currency: null,  balance: 0 },
      ];

  const createdAccounts = accountDefs.map((def, idx) => {
    const suffix = Math.floor(Math.random() * 90000000 + 10000000);
    const type = def.type || 'current';
    const isCrypto = type === 'crypto';
    const bal = parseFloat(def.balance) || 0;

    const acc = {
      id:       `acc_${uuidv4().slice(0, 8)}`,
      userId,
      type,
      label:    TYPE_LABELS[type] || 'Account',
      currency: isCrypto ? null : (def.currency || 'GBP'),
      balance:  bal,
    };

    if (isCrypto) {
      acc.cryptoAddresses = def.cryptoAddresses || DEFAULT_CRYPTO_ADDRS;
    } else {
      acc.iban          = `GI75 TNBK ${String(idx).padStart(4,'0')} 0${suffix}`;
      acc.accountNumber = String(suffix);
      acc.sortCode      = '56-00-20';
    }

    // If opening balance > 0, record a transaction
    if (bal > 0 && !isCrypto) {
      const { transactions } = require('../db');
      transactions.push({
        id:          uuidv4(),
        accountId:   acc.id,
        type:        'credit',
        amount:      bal,
        currency:    acc.currency,
        description: 'Opening balance',
        reference:   `OPEN-${Date.now()}`,
        counterparty:'Trusted Novus Bank',
        date:        new Date().toISOString(),
        status:      'completed',
      });
    }

    return acc;
  });

  users.push(newUser);
  accounts.push(...createdAccounts);

  return res.status(201).json({
    message: 'Client registered successfully',
    client: {
      id: userId,
      username: newUser.username,
      firstName,
      lastName,
      email,
      accounts: createdAccounts,
    },
  });
});

// ─── DELETE /api/admin/clients/:id ───────────────────────────────
router.delete('/clients/:id', auth, adminOnly, (req, res) => {
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  users.splice(idx, 1);
  // Remove their accounts too
  const toRemove = accounts.filter(a => a.userId === req.params.id).map(a => a.id);
  toRemove.forEach(aid => {
    const i = accounts.findIndex(a => a.id === aid);
    if (i !== -1) accounts.splice(i, 1);
  });
  return res.json({ message: 'Client deleted' });
});

// ─── POST /api/admin/credit ──────────────────────────────────────
// Manually credit an account
router.post('/credit', auth, adminOnly, (req, res) => {
  const { accountId, amount, description, currency } = req.body;

  if (!accountId || !amount) {
    return res.status(400).json({ error: 'accountId and amount are required' });
  }

  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  const account = accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  account.balance = parseFloat((account.balance + parsed).toFixed(2));

  const txn = {
    id: uuidv4(),
    accountId,
    type: 'credit',
    amount: parsed,
    currency: account.currency || currency || 'GBP',
    description: description || 'Manual credit by bank',
    reference: `ADM-CR-${Date.now()}`,
    counterparty: 'Trusted Novus Bank',
    date: new Date().toISOString(),
    status: 'completed',
  };

  transactions.push(txn);

  return res.status(201).json({
    message: 'Account credited successfully',
    transaction: txn,
    newBalance: account.balance,
  });
});

// ─── POST /api/admin/debit ───────────────────────────────────────
// Manually debit an account
router.post('/debit', auth, adminOnly, (req, res) => {
  const { accountId, amount, description, currency } = req.body;

  if (!accountId || !amount) {
    return res.status(400).json({ error: 'accountId and amount are required' });
  }

  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  const account = accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  if (account.balance < parsed) {
    return res.status(422).json({ error: 'Insufficient funds in account' });
  }

  account.balance = parseFloat((account.balance - parsed).toFixed(2));

  const txn = {
    id: uuidv4(),
    accountId,
    type: 'debit',
    amount: parsed,
    currency: account.currency || currency || 'GBP',
    description: description || 'Manual debit by bank',
    reference: `ADM-DB-${Date.now()}`,
    counterparty: 'Trusted Novus Bank',
    date: new Date().toISOString(),
    status: 'completed',
  };

  transactions.push(txn);

  return res.status(201).json({
    message: 'Account debited successfully',
    transaction: txn,
    newBalance: account.balance,
  });
});

module.exports = router;
