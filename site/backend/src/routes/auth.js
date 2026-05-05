const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const otplib = require('otplib');
const QRCode = require('qrcode');
const { pool } = require('../config/db');
const { sendMail } = require('../config/mailer');
const authMiddleware = require('../middleware/auth');
const { JWT_SECRET } = require('../middleware/auth');

const TOTP_ISSUER = process.env.TOTP_ISSUER || 'Portfolio Manager';
const OTP_TTL_MINUTES = 10;

function issueSessionToken(user) {
  return jwt.sign({ id: Number(user.id), email: user.email }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

function issuePending2faToken(user) {
  return jwt.sign(
    { id: Number(user.id), email: user.email, twofa: 'pending' },
    JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function verifyPending2faToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.twofa !== 'pending') return null;
    return decoded;
  } catch {
    return null;
  }
}

function publicUser(u) {
  return {
    id: Number(u.id),
    email: u.email,
    name: u.name,
    totp_enabled: !!u.totp_enabled,
    email_otp_enabled: !!u.email_otp_enabled,
  };
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

router.post('/register', async (req, res) => {
  let conn;
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    conn = await pool.getConnection();
    const existing = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await conn.query(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashed, name || null]
    );

    const user = {
      id: Number(result.insertId),
      email,
      name: name || null,
      totp_enabled: 0,
      email_otp_enabled: 0,
    };
    const token = issueSessionToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/login', async (req, res) => {
  let conn;
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const methods = [];
    if (user.totp_enabled) methods.push('totp');
    if (user.email_otp_enabled) methods.push('email');

    if (methods.length > 0) {
      const pendingToken = issuePending2faToken(user);
      return res.json({
        requires2fa: true,
        methods,
        pending_token: pendingToken,
      });
    }

    const token = issueSessionToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Send an email OTP using the pending 2FA token
router.post('/2fa/email/send', async (req, res) => {
  let conn;
  try {
    const { pending_token } = req.body;
    const decoded = verifyPending2faToken(pending_token);
    if (!decoded) return res.status(401).json({ error: 'Invalid or expired session' });

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    if (!user.email_otp_enabled) {
      return res.status(400).json({ error: 'Email OTP not enabled for this account' });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await conn.query(
      "INSERT INTO email_otps (user_id, purpose, code_hash, expires_at) VALUES (?, 'login', ?, ?)",
      [user.id, codeHash, expiresAt]
    );

    await sendMail({
      to: user.email,
      subject: 'Your Portfolio Manager verification code',
      text: `Your verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      html: `<p>Your verification code is <b>${code}</b>.</p><p>It expires in ${OTP_TTL_MINUTES} minutes.</p>`,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Verify a 2FA code (TOTP or email) and exchange the pending token for a full session
router.post('/2fa/verify', async (req, res) => {
  let conn;
  try {
    const { pending_token, method, code } = req.body;
    const decoded = verifyPending2faToken(pending_token);
    if (!decoded) return res.status(401).json({ error: 'Invalid or expired session' });
    if (!code) return res.status(400).json({ error: 'Code is required' });

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    if (method === 'totp') {
      if (!user.totp_enabled || !user.totp_secret) {
        return res.status(400).json({ error: 'TOTP not enabled' });
      }
      const result = await otplib.verify({
        secret: user.totp_secret,
        token: String(code).replace(/\s+/g, ''),
      });
      if (!result.valid) return res.status(401).json({ error: 'Invalid code' });
    } else if (method === 'email') {
      if (!user.email_otp_enabled) {
        return res.status(400).json({ error: 'Email OTP not enabled' });
      }
      const codeHash = hashCode(String(code).trim());
      const otpRows = await conn.query(
        `SELECT * FROM email_otps
         WHERE user_id = ? AND purpose = 'login' AND code_hash = ?
           AND used = 0 AND expires_at > NOW()
         ORDER BY id DESC LIMIT 1`,
        [user.id, codeHash]
      );
      if (otpRows.length === 0) {
        return res.status(401).json({ error: 'Invalid or expired code' });
      }
      await conn.query('UPDATE email_otps SET used = 1 WHERE id = ?', [otpRows[0].id]);
    } else {
      return res.status(400).json({ error: 'Unknown method' });
    }

    const token = issueSessionToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT id, email, name, totp_enabled, email_otp_enabled, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(publicUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Begin TOTP enrollment: generate a secret and return otpauth URI + QR code
router.post('/2fa/totp/setup', authMiddleware, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT email FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const secret = otplib.generateSecret();
    const otpauth = otplib.generateURI({
      secret,
      label: rows[0].email,
      issuer: TOTP_ISSUER,
    });
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Store secret but keep totp_enabled = 0 until verified
    await conn.query(
      'UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?',
      [secret, req.user.id]
    );

    res.json({ secret, otpauth, qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Confirm TOTP enrollment by verifying a code from the authenticator app
router.post('/2fa/totp/enable', authMiddleware, async (req, res) => {
  let conn;
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0 || !rows[0].totp_secret) {
      return res.status(400).json({ error: 'No pending TOTP setup' });
    }
    const result = await otplib.verify({
      secret: rows[0].totp_secret,
      token: String(code).replace(/\s+/g, ''),
    });
    if (!result.valid) return res.status(401).json({ error: 'Invalid code' });

    await conn.query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/2fa/totp/disable', authMiddleware, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/2fa/email/enable', authMiddleware, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE users SET email_otp_enabled = 1 WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/2fa/email/disable', authMiddleware, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE users SET email_otp_enabled = 0 WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// --- Profile management ---
router.patch('/me', authMiddleware, async (req, res) => {
  let conn;
  try {
    const { name, email } = req.body;
    if (name === undefined && email === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    conn = await pool.getConnection();

    if (email !== undefined) {
      const dup = await conn.query(
        'SELECT id FROM users WHERE email = ? AND id <> ?',
        [email, req.user.id]
      );
      if (dup.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    const fields = [];
    const values = [];
    if (name !== undefined) {
      fields.push('name = ?');
      values.push(name);
    }
    if (email !== undefined) {
      fields.push('email = ?');
      values.push(email);
    }
    values.push(req.user.id);

    await conn.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    const rows = await conn.query(
      'SELECT id, email, name, totp_enabled, email_otp_enabled FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(publicUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/change-password', authMiddleware, async (req, res) => {
  let conn;
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(current_password, rows[0].password);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(new_password, 10);
    await conn.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/me', authMiddleware, async (req, res) => {
  let conn;
  try {
    const { current_password } = req.body || {};
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required' });
    }

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(current_password, rows[0].password);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    // Cascading FKs will remove portfolios → holdings → transactions/dividends, and email_otps.
    await conn.query('DELETE FROM users WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// --- Forgot password ---
// Always responds with { ok: true } to avoid leaking which emails are registered.
router.post('/forgot-password', async (req, res) => {
  let conn;
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT id, email FROM users WHERE email = ?', [email]);
    if (rows.length > 0) {
      const user = rows[0];
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const codeHash = hashCode(code);
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

      await conn.query(
        "INSERT INTO email_otps (user_id, purpose, code_hash, expires_at) VALUES (?, 'reset', ?, ?)",
        [user.id, codeHash, expiresAt]
      );

      try {
        await sendMail({
          to: user.email,
          subject: 'Reset your Portfolio Manager password',
          text: `Your password reset code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
          html: `<p>Your password reset code is <b>${code}</b>.</p>
                 <p>It expires in ${OTP_TTL_MINUTES} minutes.</p>
                 <p>If you did not request this, you can ignore this email.</p>`,
        });
      } catch (mailErr) {
        console.error('Failed to send reset email:', mailErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/reset-password', async (req, res) => {
  let conn;
  try {
    const { email, code, new_password } = req.body;
    if (!email || !code || !new_password) {
      return res.status(400).json({ error: 'Email, code and new password are required' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      // Same generic error as bad code, to avoid email enumeration.
      return res.status(401).json({ error: 'Invalid or expired code' });
    }
    const userId = rows[0].id;

    const codeHash = hashCode(String(code).trim());
    const otpRows = await conn.query(
      `SELECT id FROM email_otps
       WHERE user_id = ? AND purpose = 'reset' AND code_hash = ?
         AND used = 0 AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [userId, codeHash]
    );
    if (otpRows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await conn.query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    await conn.query('UPDATE email_otps SET used = 1 WHERE id = ?', [otpRows[0].id]);
    // Invalidate any other outstanding reset codes for this user.
    await conn.query(
      "UPDATE email_otps SET used = 1 WHERE user_id = ? AND purpose = 'reset' AND used = 0",
      [userId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
