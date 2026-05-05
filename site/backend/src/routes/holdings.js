const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');

// GET /detail/:id — MUST be before /:portfolioId to avoid route conflict
router.get('/detail/:id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT h.*,
        (h.quantity * h.average_cost) AS book_value,
        (h.quantity * COALESCE(h.current_price, h.average_cost)) AS market_value,
        COALESCE((
          SELECT SUM(t.realized_pnl) FROM transactions t
          WHERE t.holding_id = h.id AND t.type = 'SELL'
        ), 0) AS realized_pnl,
        e.category, e.notes,
        e.sector AS etf_sector, e.region AS etf_region,
        e.manager, e.fund_page, e.dividend_payout, e.consistent_dividends
      FROM holdings h
      LEFT JOIN etf_master e ON e.symbol = h.symbol
      JOIN portfolios p ON p.id = h.portfolio_id
      WHERE h.id = ? AND p.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Holding not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// GET /:portfolioId
router.get('/:portfolioId', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const portfolio = await conn.query(
      'SELECT id FROM portfolios WHERE id = ? AND user_id = ?',
      [req.params.portfolioId, req.user.id]
    );
    if (portfolio.length === 0) return res.status(404).json({ error: 'Portfolio not found' });
    const rows = await conn.query(
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
        e.category, e.notes,
        e.sector AS etf_sector, e.region AS etf_region,
        e.manager, e.fund_page, e.dividend_payout, e.consistent_dividends
      FROM holdings h
      LEFT JOIN etf_master e ON e.symbol = h.symbol
      WHERE h.portfolio_id = ?
      ORDER BY h.symbol`,
      [req.params.portfolioId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/', auth, async (req, res) => {
  let conn;
  try {
    const { portfolio_id, symbol, name, type } = req.body;
    if (!portfolio_id || !symbol) return res.status(400).json({ error: 'portfolio_id and symbol are required' });
    const holdingType = type || 'SHARE';
    if (!['ETF', 'SHARE'].includes(holdingType)) return res.status(400).json({ error: 'Type must be ETF or SHARE' });
    conn = await pool.getConnection();
    const portfolio = await conn.query(
      'SELECT id FROM portfolios WHERE id = ? AND user_id = ?',
      [portfolio_id, req.user.id]
    );
    if (portfolio.length === 0) return res.status(404).json({ error: 'Portfolio not found' });
    const result = await conn.query(
      'INSERT INTO holdings (portfolio_id, symbol, name, type) VALUES (?, ?, ?, ?)',
      [portfolio_id, symbol.toUpperCase(), name || null, holdingType]
    );
    res.status(201).json({ id: Number(result.insertId), portfolio_id, symbol: symbol.toUpperCase(), name: name || null, type: holdingType, quantity: 0, average_cost: 0 });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Holding with this symbol already exists in portfolio' });
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', auth, async (req, res) => {
  let conn;
  try {
    const { symbol, name, type, sector, region, management_fee } = req.body;
    conn = await pool.getConnection();
    const existing = await conn.query(
      `SELECT h.* FROM holdings h
       JOIN portfolios p ON p.id = h.portfolio_id
       WHERE h.id = ? AND p.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Holding not found' });
    if (type && !['ETF', 'SHARE'].includes(type)) return res.status(400).json({ error: 'Type must be ETF or SHARE' });

    const newSymbol = symbol ? symbol.trim().toUpperCase() : existing[0].symbol;
    if (newSymbol !== existing[0].symbol) {
      const dup = await conn.query(
        'SELECT id FROM holdings WHERE portfolio_id = ? AND symbol = ? AND id != ?',
        [existing[0].portfolio_id, newSymbol, req.params.id]
      );
      if (dup.length > 0) return res.status(409).json({ error: `Symbol ${newSymbol} already exists` });
    }

    await conn.query(
      `UPDATE holdings SET symbol=?, name=?, type=?, sector=?, region=?, management_fee=? WHERE id=?`,
      [
        newSymbol,
        name !== undefined ? name : existing[0].name,
        type || existing[0].type,
        sector !== undefined ? sector : existing[0].sector,
        region !== undefined ? region : existing[0].region,
        management_fee !== undefined ? management_fee : existing[0].management_fee,
        req.params.id
      ]
    );
    const updated = await conn.query('SELECT * FROM holdings WHERE id = ?', [req.params.id]);
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
      `DELETE h FROM holdings h
       JOIN portfolios p ON p.id = h.portfolio_id
       WHERE h.id = ? AND p.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Holding not found' });
    res.json({ message: 'Holding deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
