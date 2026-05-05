const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM etf_master ORDER BY symbol');
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
    const { symbol, description, sector, region, manager, fund_page,
            dividend_payout, consistent_dividends, category, notes } = req.body;
    if (!symbol || !description) return res.status(400).json({ error: 'Symbol and description are required' });
    const base_symbol = symbol.trim().toUpperCase().replace(/\.(TO|NE|V|CN|TSX)$/i, '');
    conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO etf_master
        (symbol, base_symbol, description, sector, region, manager, fund_page,
         dividend_payout, consistent_dividends, category, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [symbol.trim().toUpperCase(), base_symbol, description.trim(),
       sector || null, region || null, manager || null, fund_page || null,
       dividend_payout || null,
       consistent_dividends !== undefined ? (consistent_dividends ? 1 : 0) : null,
       category || null, notes || null]
    );
    res.status(201).json({ message: 'ETF added successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'ETF already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', auth, async (req, res) => {
  let conn;
  try {
    const { symbol, description, sector, region, manager, fund_page,
            dividend_payout, consistent_dividends, category, notes } = req.body;
    const base_symbol = symbol.trim().toUpperCase().replace(/\.(TO|NE|V|CN|TSX)$/i, '');
    conn = await pool.getConnection();
    await conn.query(
      `UPDATE etf_master SET
        symbol=?, base_symbol=?, description=?, sector=?, region=?, manager=?,
        fund_page=?, dividend_payout=?, consistent_dividends=?, category=?, notes=?
       WHERE id=?`,
      [symbol.trim().toUpperCase(), base_symbol, description.trim(),
       sector || null, region || null, manager || null, fund_page || null,
       dividend_payout || null,
       consistent_dividends !== undefined ? (consistent_dividends ? 1 : 0) : null,
       category || null, notes || null, req.params.id]
    );
    res.json({ message: 'ETF updated' });
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
    await conn.query('DELETE FROM etf_master WHERE id=?', [req.params.id]);
    res.json({ message: 'ETF deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.get('/resolve/:baseSymbol', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT * FROM etf_master WHERE base_symbol = ? OR symbol = ?',
      [req.params.baseSymbol.toUpperCase(), req.params.baseSymbol.toUpperCase()]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'ETF not found in master list' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;

// GET /api/etfmaster/export - Export as JSON for Excel generation on frontend
router.get('/export', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM etf_master ORDER BY symbol');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/etfmaster/import - Import from parsed Excel data
router.post('/import', auth, async (req, res) => {
  let conn;
  try {
    const { rows } = req.body;
    if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
    conn = await pool.getConnection();
    let inserted = 0, updated = 0, skipped = 0;

    for (const row of rows) {
      if (!row.symbol || !row.description) { skipped++; continue; }
      const symbol = row.symbol.trim().toUpperCase();
      const base_symbol = symbol.replace(/\.(TO|NE|V|CN|TSX)$/i, '');

      // Map Pillar to category
      let category = null;
      if (row.category) {
        const cat = row.category.trim().toLowerCase();
        if (cat.startsWith('anchor')) category = 'Anchor';
        else if (cat.startsWith('booster')) category = 'Booster';
        else if (cat.startsWith('juicer')) category = 'Juicer';
        else if (cat.includes('growth')) category = 'Growth Stock';
      }

      // Map consistent_dividends
      let consistent = null;
      if (row.consistent_dividends === 'Y' || row.consistent_dividends === true) consistent = 1;
      else if (row.consistent_dividends === 'N' || row.consistent_dividends === false) consistent = 0;

      const existing = await conn.query('SELECT id FROM etf_master WHERE symbol = ?', [symbol]);
      if (existing.length > 0) {
        await conn.query(
          `UPDATE etf_master SET base_symbol=?, description=?, sector=?, region=?, manager=?,
           fund_page=?, dividend_payout=?, consistent_dividends=?, category=?, notes=?
           WHERE symbol=?`,
          [base_symbol, row.description.trim(), row.sector || null, row.region || null,
           row.manager || null, row.fund_page || null, row.dividend_payout || null,
           consistent, category, row.notes || null, symbol]
        );
        updated++;
      } else {
        await conn.query(
          `INSERT INTO etf_master (symbol, base_symbol, description, sector, region, manager,
           fund_page, dividend_payout, consistent_dividends, category, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [symbol, base_symbol, row.description.trim(), row.sector || null, row.region || null,
           row.manager || null, row.fund_page || null, row.dividend_payout || null,
           consistent, category, row.notes || null]
        );
        inserted++;
      }
    }
    res.json({ message: `Import complete`, inserted, updated, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});
