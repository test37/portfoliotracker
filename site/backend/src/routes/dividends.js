const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');

// Get dividends for a holding
router.get('/:holdingId', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const holding = await conn.query(
      `SELECT h.id FROM holdings h
       JOIN portfolios p ON p.id = h.portfolio_id
       WHERE h.id = ? AND p.user_id = ?`,
      [req.params.holdingId, req.user.id]
    );
    if (holding.length === 0) {
      return res.status(404).json({ error: 'Holding not found' });
    }

    const rows = await conn.query(
      'SELECT * FROM dividends WHERE holding_id = ? ORDER BY date DESC',
      [req.params.holdingId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Get all dividends for a portfolio
router.get('/portfolio/:portfolioId', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const portfolio = await conn.query(
      'SELECT id FROM portfolios WHERE id = ? AND user_id = ?',
      [req.params.portfolioId, req.user.id]
    );
    if (portfolio.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const rows = await conn.query(
      `SELECT d.*, h.symbol, h.name AS holding_name
       FROM dividends d
       JOIN holdings h ON h.id = d.holding_id
       WHERE h.portfolio_id = ?
       ORDER BY d.date DESC`,
      [req.params.portfolioId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Get dividend summary for a portfolio (yearly totals)
router.get('/summary/:portfolioId', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const portfolio = await conn.query(
      'SELECT id FROM portfolios WHERE id = ? AND user_id = ?',
      [req.params.portfolioId, req.user.id]
    );
    if (portfolio.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const rows = await conn.query(
      `SELECT
        h.symbol,
        h.name AS holding_name,
        YEAR(d.date) AS year,
        SUM(d.amount) AS total_dividends,
        SUM(d.tax_withheld) AS total_tax_withheld,
        COUNT(*) AS payment_count
       FROM dividends d
       JOIN holdings h ON h.id = d.holding_id
       WHERE h.portfolio_id = ?
       GROUP BY h.symbol, h.name, YEAR(d.date)
       ORDER BY YEAR(d.date) DESC, h.symbol`,
      [req.params.portfolioId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Record a dividend
router.post('/', auth, async (req, res) => {
  let conn;
  try {
    const { holding_id, amount, amount_per_share, shares_held, date, payment_date, frequency, tax_withheld, notes } = req.body;
    if (!holding_id || !amount || !date) {
      return res.status(400).json({ error: 'holding_id, amount, and date are required' });
    }

    conn = await pool.getConnection();

    const holding = await conn.query(
      `SELECT h.* FROM holdings h
       JOIN portfolios p ON p.id = h.portfolio_id
       WHERE h.id = ? AND p.user_id = ?`,
      [holding_id, req.user.id]
    );
    if (holding.length === 0) {
      return res.status(404).json({ error: 'Holding not found' });
    }

    const result = await conn.query(
      `INSERT INTO dividends (holding_id, amount, amount_per_share, shares_held, date, payment_date, frequency, tax_withheld, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        holding_id,
        amount,
        amount_per_share || null,
        shares_held || null,
        date,
        payment_date || null,
        frequency || 'quarterly',
        tax_withheld || 0,
        notes || null
      ]
    );

    res.status(201).json({
      id: Number(result.insertId),
      holding_id,
      amount,
      amount_per_share: amount_per_share || null,
      shares_held: shares_held || null,
      date,
      payment_date: payment_date || null,
      frequency: frequency || 'quarterly',
      tax_withheld: tax_withheld || 0,
      notes: notes || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Delete dividend
router.delete('/:id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const dividend = await conn.query(
      `SELECT d.id FROM dividends d
       JOIN holdings h ON h.id = d.holding_id
       JOIN portfolios p ON p.id = h.portfolio_id
       WHERE d.id = ? AND p.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (dividend.length === 0) {
      return res.status(404).json({ error: 'Dividend not found' });
    }

    await conn.query('DELETE FROM dividends WHERE id = ?', [req.params.id]);
    res.json({ message: 'Dividend deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
