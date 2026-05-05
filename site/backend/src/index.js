require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./config/db');

// Handle BigInt serialization from MariaDB COUNT/SUM results
BigInt.prototype.toJSON = function () {
  return Number(this);
};

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Portfolio API running' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/portfolios', require('./routes/portfolios'));
app.use('/api/holdings', require('./routes/holdings'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/dividends', require('./routes/dividends'));
app.use('/api/prices', require('./routes/prices'));
app.use('/api/imports', require('./routes/imports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/etfmaster', require('./routes/etfmaster'));

const PORT = process.env.PORT || 4100;

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Portfolio API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
