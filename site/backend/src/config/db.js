const mariadb = require('mariadb');

const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'mariadb',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'portfolio_user',
  password: process.env.DB_PASSWORD || 'portfolio_pass',
  database: process.env.DB_NAME || 'portfolio_db',
  connectionLimit: 10,
  connectTimeout: 10000,
});

async function initDatabase() {
  let conn;
  try {
    conn = await pool.getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        totp_secret VARCHAR(255) DEFAULT NULL,
        totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
        email_otp_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add 2FA columns for pre-existing user tables
    const userCols = await conn.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    const colNames = userCols.map((r) => r.COLUMN_NAME);
    if (!colNames.includes('totp_secret')) {
      await conn.query('ALTER TABLE users ADD COLUMN totp_secret VARCHAR(255) DEFAULT NULL');
    }
    if (!colNames.includes('totp_enabled')) {
      await conn.query('ALTER TABLE users ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!colNames.includes('email_otp_enabled')) {
      await conn.query('ALTER TABLE users ADD COLUMN email_otp_enabled TINYINT(1) NOT NULL DEFAULT 0');
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS email_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        purpose VARCHAR(20) NOT NULL DEFAULT 'login',
        code_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    const otpCols = await conn.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_otps'"
    );
    if (!otpCols.map((r) => r.COLUMN_NAME).includes('purpose')) {
      await conn.query(
        "ALTER TABLE email_otps ADD COLUMN purpose VARCHAR(20) NOT NULL DEFAULT 'login' AFTER user_id"
      );
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        type ENUM('RRSP', 'LIRA', 'TFSA', 'Non-Registered') NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS holdings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        portfolio_id INT NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        type ENUM('ETF', 'SHARE') NOT NULL DEFAULT 'SHARE',
        quantity DECIMAL(18,6) NOT NULL DEFAULT 0,
        average_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
        current_price DECIMAL(18,6) DEFAULT NULL,
        price_updated_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
        UNIQUE KEY unique_holding (portfolio_id, symbol)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        holding_id INT NOT NULL,
        type ENUM('BUY','SELL') NOT NULL DEFAULT 'BUY',
        quantity DECIMAL(18,6) NOT NULL,
        price DECIMAL(18,6) NOT NULL,
        commission DECIMAL(18,6) NOT NULL DEFAULT 0,
        total DECIMAL(18,6) NOT NULL,
        realized_pnl DECIMAL(18,6) DEFAULT NULL,
        date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
      )
    `);

    // Migrate transactions table from BUY-only to BUY/SELL with realized_pnl.
    const txCols = await conn.query(
      "SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions'"
    );
    const txColMap = new Map(txCols.map((r) => [r.COLUMN_NAME, r.COLUMN_TYPE]));
    if (txColMap.has('type') && !String(txColMap.get('type')).toLowerCase().includes("'sell'")) {
      await conn.query(
        "ALTER TABLE transactions MODIFY COLUMN type ENUM('BUY','SELL') NOT NULL DEFAULT 'BUY'"
      );
    }
    if (!txColMap.has('realized_pnl')) {
      await conn.query(
        'ALTER TABLE transactions ADD COLUMN realized_pnl DECIMAL(18,6) DEFAULT NULL AFTER total'
      );
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS dividends (
        id INT AUTO_INCREMENT PRIMARY KEY,
        holding_id INT NOT NULL,
        amount DECIMAL(18,6) NOT NULL,
        amount_per_share DECIMAL(18,6),
        shares_held DECIMAL(18,6),
        date DATE NOT NULL,
        payment_date DATE,
        frequency ENUM('monthly', 'quarterly', 'semi-annual', 'annual') DEFAULT 'quarterly',
        tax_withheld DECIMAL(18,6) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        price DECIMAL(18,6) NOT NULL,
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_symbol (symbol),
        INDEX idx_fetched_at (fetched_at)
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err.message);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { pool, initDatabase };
