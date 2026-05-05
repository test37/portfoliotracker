const nodemailer = require('nodemailer');
const {
  SMTP_HOST, SMTP_PORT, SMTP_USER,
  SMTP_PASS, SMTP_SECURE, SMTP_FROM,
} = process.env;

// Create transporter from settings object
function createTransporter(settings) {
  if (!settings || !settings.smtp_host) return null;
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port, 10) || 587,
    secure: !!settings.smtp_secure,
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_pass } : undefined,
  });
}

// Default transporter from environment variables (fallback)
const envTransporter = SMTP_HOST ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: parseInt(SMTP_PORT, 10) || 587,
  secure: SMTP_SECURE === 'true',
  auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
}) : null;

async function getTransporterForUser(userId) {
  if (!userId) return { transporter: envTransporter, from: SMTP_FROM || 'no-reply@portfolio.local' };
  try {
    const { pool } = require('./db');
    let conn;
    try {
      conn = await pool.getConnection();
      const rows = await conn.query(
        'SELECT * FROM user_settings WHERE user_id = ?',
        [userId]
      );
      if (rows.length > 0 && rows[0].smtp_host && rows[0].smtp_user && rows[0].smtp_pass) {
        const s = rows[0];
        return {
          transporter: createTransporter(s),
          from: s.smtp_from || s.smtp_user,
        };
      }
    } finally {
      if (conn) conn.release();
    }
  } catch (err) {
    console.error('Failed to load user SMTP settings:', err.message);
  }
  return { transporter: envTransporter, from: SMTP_FROM || 'no-reply@portfolio.local' };
}

async function sendMail({ to, subject, text, html, userId }) {
  const { transporter, from } = await getTransporterForUser(userId);
  if (!transporter) {
    console.log(`[mailer:dev] To: ${to} | ${subject}\n${text}`);
    return { dev: true };
  }
  return transporter.sendMail({ from, to, subject, text, html });
}

module.exports = { sendMail };
