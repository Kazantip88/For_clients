const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const db = require('../db');
const mailer = require('../mailer');

function logActivity(userId, action, details = {}) {
  if (!db.activityLog) return;
  db.activityLog.push({ id: require('crypto').randomUUID(), userId, action, details, date: new Date().toISOString() });
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const user = db.users.find(u => u.username === username.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.blocked) return res.status(403).json({ error: 'Account is blocked. Please contact support.' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
    logActivity(user.id, 'login', { ip: req.ip, username: user.username });
    mailer.notifyLogin(user, req.ip).catch(e => console.error('mailer error:', e.message));
    return res.json({ token, user: { id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName, email: user.email, isAdmin: !!user.isAdmin, mustChangePassword: !!user.mustChangePassword } });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName, email: user.email, isAdmin: !!user.isAdmin, mustChangePassword: !!user.mustChangePassword });
});

router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  logActivity(user.id, 'password_changed', { ip: req.ip });
  mailer.notifyPasswordChanged(user).catch(e => console.error('mailer error:', e.message));
  return res.json({ message: 'Password changed successfully' });
});

module.exports = router;
