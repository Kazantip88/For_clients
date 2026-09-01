require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 100, message: { error: 'Too many requests' } });
app.use('/api/', limiter);
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Too many login attempts' } });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/auth', loginLimiter, require('./routes/auth'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/transfers', require('./routes/transfers'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' }));
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

app.listen(PORT, () => console.log(`\n🏦 Trusted Novus Bank API running on port ${PORT}\n`));
