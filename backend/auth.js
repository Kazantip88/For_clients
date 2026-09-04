const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const pool = require('../db');
const tg = require('../telegram');

async function logActivity(userId, action, details = {}, adminId = null) {
  try {
    await pool.query(`INSERT INTO activity_log (id,user_id,admin_id,action,details) VALUES ($1,$2,$3,$4,$5)`,
      [uuidv4(), userId, adminId, action, JSON.stringify(details)]);
  } catch(e) { console.error('logActivity error:', e.message); }
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const { rows } = await pool.query(`SELECT * FROM users WHERE username=$1`, [username.toLowerCase().trim()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.blocked) return res.status(403).json({ error: 'Account is blocked. Please contact support.' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
    await logActivity(user.id, 'login', { ip: req.ip });
    tg.notifyLogin({ firstName: user.first_name, lastName: user.last_name, username: user.username }, req.ip).catch(() => {});
    return res.json({ token, user: { id: user.id, username: user.username, firstName: user.first_name, lastName: user.last_name, email: user.email, isAdmin: user.is_admin, mustChangePassword: user.must_change_password } });
  } catch(e) { console.error('Login error:', e); return res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/me', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ id: user.id, username: user.username, firstName: user.first_name, lastName: user.last_name, email: user.email, isAdmin: user.is_admin, mustChangePassword: user.must_change_password });
});

router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Min. 8 characters' });
  const { rows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE users SET password_hash=$1, must_change_password=false WHERE id=$2`, [hash, user.id]);
  await logActivity(user.id, 'password_changed', { ip: req.ip });
  tg.notifyPasswordChanged({ firstName: user.first_name, lastName: user.last_name, username: user.username }).catch(() => {});
  return res.json({ message: 'Password changed successfully' });
});

module.exports = router;
