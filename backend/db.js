// db.js — JSON file-backed database
// All data persists to db-data.json on every write operation
const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, 'db-data.json');

// ─── DEFAULT DATA (used only if db-data.json doesn't exist) ──────
function getDefaults() {
  const passwordHash = bcrypt.hashSync('qwerty123', 10);
  return {
    users: [
      {
        id: 'usr_001',
        username: 'john.smith',
        passwordHash,
        firstName: 'John',
        lastName: 'Smith',
        email: 'j.smith@example.com',
        isAdmin: true,
        createdAt: new Date().toISOString(),
      },
    ],
    accounts: [
      {
        id: 'acc_001', userId: 'usr_001',
        type: 'current', label: 'Current Account',
        currency: 'GBP',
        iban: 'GI75 NWBK 0000 0700 1234 56',
        accountNumber: '70012345', sortCode: '56-00-20',
        balance: 14250.80,
      },
      {
        id: 'acc_002', userId: 'usr_001',
        type: 'savings', label: 'Savings Account',
        currency: 'GBP',
        iban: 'GI75 NWBK 0000 0700 6543 21',
        accountNumber: '70065432', sortCode: '56-00-20',
        balance: 32100.00,
      },
      {
        id: 'acc_003', userId: 'usr_001',
        type: 'crypto', label: 'Crypto Account',
        currency: null,
        cryptoAddresses: {
          BTC:  '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf9n',
          ETH:  '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          USDT: 'TN3W8e4BKMBK4K3nKzMr4jGxQMm3cVKgXj',
        },
        balance: 0,
      },
    ],
    transactions: [
      {
        id: uuidv4(), accountId: 'acc_001', type: 'credit',
        amount: 5000.00, currency: 'GBP',
        description: 'Salary - Acme Corp Ltd', reference: 'SAL-2026-06',
        counterparty: 'Acme Corp Ltd', date: '2026-06-01T09:00:00Z', status: 'completed',
      },
      {
        id: uuidv4(), accountId: 'acc_001', type: 'debit',
        amount: 1200.00, currency: 'GBP',
        description: 'Rent payment', reference: 'RENT-JUNE',
        counterparty: 'Gibraltar Properties Ltd', date: '2026-06-02T11:30:00Z', status: 'completed',
      },
      {
        id: uuidv4(), accountId: 'acc_001', type: 'debit',
        amount: 85.50, currency: 'GBP',
        description: 'Supermarket', reference: 'POS-4421',
        counterparty: 'Morrison Gibraltar', date: '2026-06-05T14:20:00Z', status: 'completed',
      },
      {
        id: uuidv4(), accountId: 'acc_001', type: 'credit',
        amount: 350.00, currency: 'GBP',
        description: 'Transfer received', reference: 'TRF-8812',
        counterparty: 'Maria Rodriguez', date: '2026-06-10T16:45:00Z', status: 'completed',
      },
      {
        id: uuidv4(), accountId: 'acc_002', type: 'credit',
        amount: 2000.00, currency: 'GBP',
        description: 'Transfer to savings', reference: 'INT-TRF-001',
        counterparty: 'Self transfer', date: '2026-06-01T10:00:00Z', status: 'completed',
      },
    ],
    pendingTransfers: [],
  };
}

// ─── LOAD FROM FILE ───────────────────────────────────────────────
function load() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      console.log(`📂 Loaded data from db-data.json (${parsed.users?.length || 0} users, ${parsed.accounts?.length || 0} accounts, ${parsed.transactions?.length || 0} transactions)`);
      return {
        users:            parsed.users            || [],
        accounts:         parsed.accounts         || [],
        transactions:     parsed.transactions     || [],
        pendingTransfers: parsed.pendingTransfers || [],
        activityLog:      parsed.activityLog      || [],
      };
    } catch (e) {
      console.error('⚠️  Failed to parse db-data.json, using defaults:', e.message);
    }
  } else {
    console.log('📝 db-data.json not found, creating with default data…');
  }
  const defaults = getDefaults();
  save(defaults);
  return defaults;
}

// ─── SAVE TO FILE ─────────────────────────────────────────────────
let saveTimer = null;
function save(data) {
  // Debounce — write max once per 300ms to avoid hammering disk
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data || db, null, 2), 'utf8');
    } catch (e) {
      console.error('⚠️  Failed to save db-data.json:', e.message);
    }
  }, 300);
}

// ─── LIVE DB OBJECT ───────────────────────────────────────────────
// All arrays are exported by reference — mutations are auto-saved
// via the Proxy wrapper below.
const raw = load();

// Wrap each top-level array in a Proxy so any mutation triggers save()
function watchArray(arr, name) {
  return new Proxy(arr, {
    set(target, prop, value) {
      target[prop] = value;
      save();
      return true;
    },
    get(target, prop) {
      const val = target[prop];
      if (typeof val === 'function') {
        return function(...args) {
          const result = Array.prototype[prop].apply(target, args);
          save();
          return result;
        };
      }
      return val;
    },
  });
}

const db = {
  users:            watchArray(raw.users,            'users'),
  accounts:         watchArray(raw.accounts,         'accounts'),
  transactions:     watchArray(raw.transactions,     'transactions'),
  pendingTransfers: watchArray(raw.pendingTransfers, 'pendingTransfers'),
  activityLog:      watchArray(raw.activityLog||[],  'activityLog'),
};

module.exports = db;
