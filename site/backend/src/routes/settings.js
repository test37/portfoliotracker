const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');
const nodemailer = require('nodemailer');

// GET /api/settings
router.get('/', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT * FROM user_settings WHERE user_id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.json({
        smtp_host: '', smtp_port: 587, smtp_user: '',
        smtp_pass: '', smtp_from: '', smtp_secure: false,
        alpha_vantage_key: '',
      });
    }
    const s = rows[0];
    res.json({
      smtp_host: s.smtp_host || '',
      smtp_port: s.smtp_port || 587,
      smtp_user: s.smtp_user || '',
      smtp_pass: s.smtp_pass ? '••••••••' : '',
      smtp_from: s.smtp_from || '',
      smtp_secure: !!s.smtp_secure,
      alpha_vantage_key: s.alpha_vantage_key ? s.alpha_vantage_key.slice(0, 6) + '••••••••••' : '',
      has_smtp: !!(s.smtp_host && s.smtp_user && s.smtp_pass),
      has_alpha: !!s.alpha_vantage_key,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/settings/smtp
router.put('/smtp', auth, async (req, res) => {
  let conn;
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure } = req.body;
    conn = await pool.getConnection();
    const existing = await conn.query(
      'SELECT id, smtp_pass FROM user_settings WHERE user_id = ?',
      [req.user.id]
    );
    // Keep existing password if masked value sent
    const finalPass = smtp_pass === '••••••••' && existing.length > 0
      ? existing[0].smtp_pass
      : smtp_pass;

    if (existing.length === 0) {
      await conn.query(
        `INSERT INTO user_settings (user_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, smtp_host, smtp_port || 587, smtp_user, finalPass, smtp_from, smtp_secure ? 1 : 0]
      );
    } else {
      await conn.query(
        `UPDATE user_settings SET smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_from=?, smtp_secure=?
         WHERE user_id=?`,
        [smtp_host, smtp_port || 587, smtp_user, finalPass, smtp_from, smtp_secure ? 1 : 0, req.user.id]
      );
    }
    res.json({ message: 'SMTP settings saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/settings/smtp/test
router.post('/smtp/test', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT * FROM user_settings WHERE user_id = ?',
      [req.user.id]
    );
    if (rows.length === 0 || !rows[0].smtp_host) {
      return res.status(400).json({ error: 'No SMTP settings configured' });
    }
    const s = rows[0];
    const transporter = nodemailer.createTransport({
      host: s.smtp_host,
      port: s.smtp_port || 587,
      secure: !!s.smtp_secure,
      auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
    });
    // Get user email
    const users = await conn.query('SELECT email FROM users WHERE id = ?', [req.user.id]);
    const to = users[0]?.email;
    await transporter.sendMail({
      from: s.smtp_from || s.smtp_user,
      to,
      subject: 'Portfolio Manager — SMTP Test',
      text: 'Your SMTP settings are working correctly!',
      html: '<p>Your SMTP settings are working correctly! ✅</p>',
    });
    res.json({ message: `Test email sent to ${to}` });
  } catch (err) {
    res.status(500).json({ error: `SMTP test failed: ${err.message}` });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/settings/apikeys
router.put('/apikeys', auth, async (req, res) => {
  let conn;
  try {
    const { alpha_vantage_key } = req.body;
    conn = await pool.getConnection();
    const existing = await conn.query(
      'SELECT id FROM user_settings WHERE user_id = ?',
      [req.user.id]
    );
    if (existing.length === 0) {
      await conn.query(
        'INSERT INTO user_settings (user_id, alpha_vantage_key) VALUES (?, ?)',
        [req.user.id, alpha_vantage_key]
      );
    } else {
      await conn.query(
        'UPDATE user_settings SET alpha_vantage_key = ? WHERE user_id = ?',
        [alpha_vantage_key, req.user.id]
      );
    }
    res.json({ message: 'API keys saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/settings/apikeys/test
router.post('/apikeys/test', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT alpha_vantage_key FROM user_settings WHERE user_id = ?',
      [req.user.id]
    );
    if (rows.length === 0 || !rows[0].alpha_vantage_key) {
      return res.status(400).json({ error: 'No Alpha Vantage key configured' });
    }
    const key = rows[0].alpha_vantage_key;
    const r = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${key}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await r.json();
    if (data.Note || data.Information) {
      return res.status(400).json({ error: 'Rate limit hit or invalid key' });
    }
    const quote = data['Global Quote'];
    if (!quote || !quote['05. price']) {
      return res.status(400).json({ error: 'Invalid API key or no data returned' });
    }
    res.json({ message: `API key works! IBM price: $${quote['05. price']}` });
  } catch (err) {
    res.status(500).json({ error: `Test failed: ${err.message}` });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
