// db.js — In-memory mock database (replace with PostgreSQL/MongoDB in production)
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const passwordHash = bcrypt.hashSync('Demo1234!', 10);

const users = [
  {
    id: 'usr_001',
    username: 'john.smith',
    passwordHash,
    firstName: 'John',
    lastName: 'Smith',
    email: 'j.smith@example.com',
  },
];

const accounts = [
  {
    id: 'acc_001',
    userId: 'usr_001',
    type: 'current',
    label: 'Current Account',
    currency: 'GBP',
    iban: 'GI75 NWBK 0000 0700 1234 56',
    accountNumber: '70012345',
    sortCode: '56-00-20',
    balance: 14250.80,
  },
  {
    id: 'acc_002',
    userId: 'usr_001',
    type: 'savings',
    label: 'Savings Account',
    currency: 'GBP',
    iban: 'GI75 NWBK 0000 0700 6543 21',
    accountNumber: '70065432',
    sortCode: '56-00-20',
    balance: 32100.00,
  },
  {
    id: 'acc_003',
    userId: 'usr_001',
    type: 'crypto',
    label: 'Crypto Account',
    currency: null,
    // Deposit addresses for each supported coin
    cryptoAddresses: {
      BTC: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf9n',
      ETH: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      USDT: 'TN3W8e4BKMBK4K3nKzMr4jGxQMm3cVKgXj',
    },
    balance: 0,
  },
];

const transactions = [
  {
    id: uuidv4(),
    accountId: 'acc_001',
    type: 'credit',
    amount: 5000.00,
    currency: 'GBP',
    description: 'Salary - Acme Corp Ltd',
    reference: 'SAL-2026-06',
    counterparty: 'Acme Corp Ltd',
    date: '2026-06-01T09:00:00Z',
    status: 'completed',
  },
  {
    id: uuidv4(),
    accountId: 'acc_001',
    type: 'debit',
    amount: 1200.00,
    currency: 'GBP',
    description: 'Rent payment',
    reference: 'RENT-JUNE',
    counterparty: 'Gibraltar Properties Ltd',
    date: '2026-06-02T11:30:00Z',
    status: 'completed',
  },
  {
    id: uuidv4(),
    accountId: 'acc_001',
    type: 'debit',
    amount: 85.50,
    currency: 'GBP',
    description: 'Supermarket',
    reference: 'POS-4421',
    counterparty: 'Morrison Gibraltar',
    date: '2026-06-05T14:20:00Z',
    status: 'completed',
  },
  {
    id: uuidv4(),
    accountId: 'acc_001',
    type: 'credit',
    amount: 350.00,
    currency: 'GBP',
    description: 'Transfer received',
    reference: 'TRF-8812',
    counterparty: 'Maria Rodriguez',
    date: '2026-06-10T16:45:00Z',
    status: 'completed',
  },
  {
    id: uuidv4(),
    accountId: 'acc_002',
    type: 'credit',
    amount: 2000.00,
    currency: 'GBP',
    description: 'Transfer to savings',
    reference: 'INT-TRF-001',
    counterparty: 'Self transfer',
    date: '2026-06-01T10:00:00Z',
    status: 'completed',
  },
];

const pendingTransfers = [];

module.exports = { users, accounts, transactions, pendingTransfers };
