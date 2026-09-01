// migrate.js — Create tables and seed default admin
require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        blocked BOOLEAN DEFAULT FALSE,
        must_change_password BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Accounts
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        currency TEXT,
        iban TEXT,
        account_number TEXT,
        sort_code TEXT,
        balance NUMERIC(15,2) DEFAULT 0,
        crypto_addresses JSONB
      )
    `);

    // Transactions
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount NUMERIC(15,2) NOT NULL,
        currency TEXT,
        description TEXT,
        reference TEXT,
        counterparty TEXT,
        to_iban TEXT,
        sender_country TEXT,
        recipient_country TEXT,
        status TEXT DEFAULT 'completed',
        date TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Activity log
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        admin_id TEXT,
        action TEXT NOT NULL,
        details JSONB,
        date TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed admin user if not exists
    const existing = await client.query(`SELECT id FROM users WHERE username = 'john.smith'`);
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash('qwerty123', 10);
      const { v4: uuidv4 } = require('uuid');
      const userId = 'usr_001';

      await client.query(`
        INSERT INTO users (id, username, password_hash, first_name, last_name, email, is_admin)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, 'john.smith', passwordHash, 'John', 'Smith', 'j.smith@example.com', true]);

      // Current account
      const accId1 = 'acc_001';
      await client.query(`
        INSERT INTO accounts (id, user_id, type, label, currency, iban, account_number, sort_code, balance)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [accId1, userId, 'current', 'Current Account', 'GBP', 'GI75 NWBK 0000 0700 1234 56', '70012345', '56-00-20', 14250.80]);

      // Savings account
      const accId2 = 'acc_002';
      await client.query(`
        INSERT INTO accounts (id, user_id, type, label, currency, iban, account_number, sort_code, balance)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [accId2, userId, 'savings', 'Savings Account', 'GBP', 'GI75 NWBK 0000 0700 6543 21', '70065432', '56-00-20', 32100.00]);

      // Crypto account
      await client.query(`
        INSERT INTO accounts (id, user_id, type, label, currency, balance, crypto_addresses)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, ['acc_003', userId, 'crypto', 'Crypto Account', null, 0, JSON.stringify({
        BTC: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf9n',
        ETH: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        USDT: 'TN3W8e4BKMBK4K3nKzMr4jGxQMm3cVKgXj'
      })]);

      // Sample transactions
      const txns = [
        [uuidv4(), accId1, 'credit', 5000, 'GBP', 'Salary - Acme Corp Ltd', 'SAL-2026-06', 'Acme Corp Ltd', 'completed', '2026-06-01T09:00:00Z'],
        [uuidv4(), accId1, 'debit', 1200, 'GBP', 'Rent payment', 'RENT-JUNE', 'Gibraltar Properties Ltd', 'completed', '2026-06-02T11:30:00Z'],
        [uuidv4(), accId1, 'debit', 85.50, 'GBP', 'Supermarket', 'POS-4421', 'Morrison Gibraltar', 'completed', '2026-06-05T14:20:00Z'],
        [uuidv4(), accId2, 'credit', 2000, 'GBP', 'Transfer to savings', 'INT-TRF-001', 'Self transfer', 'completed', '2026-06-01T10:00:00Z'],
      ];
      for (const t of txns) {
        await client.query(`
          INSERT INTO transactions (id, account_id, type, amount, currency, description, reference, counterparty, status, date)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, t);
      }

      console.log('✅ Default admin and data seeded');
    } else {
      console.log('✅ Admin already exists, skipping seed');
    }

    await client.query('COMMIT');
    console.log('✅ Migration complete');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

migrate().then(() => process.exit(0)).catch(() => process.exit(1));
