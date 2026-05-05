const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');

const VALID_TYPES = ['RRSP', 'LIRA', 'TFSA', 'Non-Registered'];
const CURRENT_YEAR = new Date().getFullYear();

router.get('/', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT p.*,
        COALESCE(SUM(h.quantity * h.average_cost), 0) AS total_book_value,
        COALESCE(SUM(h.quantity * h.current_price), 0) AS total_market_value,
        COALESCE((
          SELECT SUM(t.realized_pnl)
          FROM transactions t
          JOIN holdings h2 ON h2.id = t.holding_id
          WHERE h2.portfolio_id = p.id AND t.type = 'SELL'
        ), 0) AS total_realized_pnl,
        COALESCE((
          SELECT SUM(c.amount)
          FROM contributions c
          WHERE c.portfolio_id = p.id
        ), 0) AS total_contributions,
        COALESCE((
          SELECT SUM(c.amount)
          FROM contributions c
          WHERE c.portfolio_id = p.id AND YEAR(c.date) = ?
        ), 0) AS current_year_contributions,
        COALESCE((
          SELECT SUM(d.amount)
          FROM dividends d
          JOIN holdings h3 ON h3.id = d.holding_id
          WHERE h3.portfolio_id = p.id
        ), 0) AS total_dividends,
        COALESCE((
          SELECT SUM(d.amount)
          FROM dividends d
          JOIN holdings h4 ON h4.id = d.holding_id
          WHERE h4.portfolio_id = p.id AND YEAR(d.date) = ?
        ), 0) AS current_year_dividends
      FROM portfolios p
      LEFT JOIN holdings h ON h.portfolio_id = p.id
      WHERE p.user_id = ?
      GROUP BY p.id
      ORDER BY p.created_at`,
      [CURRENT_YEAR, CURRENT_YEAR, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.get('/:id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const holdings = await conn.query(
      `SELECT h.*,
        (h.quantity * h.average_cost) AS book_value,
        (h.quantity * COALESCE(h.current_price, h.average_cost)) AS market_value,
        CASE WHEN h.average_cost > 0
          THEN ((COALESCE(h.current_price, h.average_cost) - h.average_cost) / h.average_cost * 100)
          ELSE 0
        END AS gain_loss_pct,
        COALESCE((
          SELECT SUM(t.realized_pnl) FROM transactions t
          WHERE t.holding_id = h.id AND t.type = 'SELL'
        ), 0) AS realized_pnl,
        COALESCE((
          SELECT SUM(d.amount) FROM dividends d
          WHERE d.holding_id = h.id
        ), 0) AS total_dividends,
        e.category, e.notes,
        e.sector AS etf_sector, e.region AS etf_region,
        e.manager, e.fund_page, e.dividend_payout, e.consistent_dividends
      FROM holdings h
      LEFT JOIN etf_master e ON e.symbol = h.symbol
      WHERE h.portfolio_id = ?
      ORDER BY h.symbol`,
      [req.params.id]
    );

    const contRows = await conn.query(
      `SELECT
        COALESCE(SUM(amount), 0) AS total_contributions,
        COALESCE(SUM(CASE WHEN YEAR(date) = ? THEN amount ELSE 0 END), 0) AS current_year_contributions
       FROM contributions WHERE portfolio_id = ?`,
      [CURRENT_YEAR, req.params.id]
    );

    const divRows = await conn.query(
      `SELECT
        COALESCE(SUM(d.amount), 0) AS total_dividends,
        COALESCE(SUM(CASE WHEN YEAR(d.date) = ? THEN d.amount ELSE 0 END), 0) AS current_year_dividends
       FROM dividends d
       JOIN holdings h ON h.id = d.holding_id
       WHERE h.portfolio_id = ?`,
      [CURRENT_YEAR, req.params.id]
    );

    res.json({
      ...rows[0],
      holdings,
      total_contributions: contRows[0].total_contributions,
      current_year_contributions: contRows[0].current_year_contributions,
      total_dividends: divRows[0].total_dividends,
      current_year_dividends: divRows[0].current_year_dividends,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/', auth, async (req, res) => {
  let conn;
  try {
    const { name, type, description, owner_name } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    conn = await pool.getConnection();
    const result = await conn.query(
      'INSERT INTO portfolios (user_id, owner_name, name, type, description) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, owner_name || null, name, type, description || null]
    );
    res.status(201).json({
      id: Number(result.insertId),
      user_id: req.user.id,
      owner_name: owner_name || null,
      name,
      type,
      description: description || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', auth, async (req, res) => {
  let conn;
  try {
    const { name, type, description, owner_name } = req.body;
    if (type && !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    conn = await pool.getConnection();
    const existing = await conn.query(
      'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    await conn.query(
      'UPDATE portfolios SET owner_name = ?, name = ?, type = ?, description = ? WHERE id = ? AND user_id = ?',
      [
        owner_name !== undefined ? owner_name : existing[0].owner_name,
        name || existing[0].name,
        type || existing[0].type,
        description !== undefined ? description : existing[0].description,
        req.params.id,
        req.user.id
      ]
    );
    const updated = await conn.query('SELECT * FROM portfolios WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(
      'DELETE FROM portfolios WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    res.json({ message: 'Portfolio deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
