const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function parseDescription(desc) {
  if (!desc) return { symbol: null, name: null };
  const dashIdx = desc.indexOf(' - ');
  if (dashIdx <= 0) return { symbol: null, name: null };
  const symbol = desc.slice(0, dashIdx).trim().toUpperCase();
  const afterDash = desc.slice(dashIdx + 3);
  const colonIdx = afterDash.indexOf(':');
  const name = colonIdx > 0 ? afterDash.slice(0, colonIdx).trim() : afterDash.trim();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return { symbol: null, name: null };
  return { symbol, name };
}

function parseShares(desc) {
  if (!desc) return null;
  const m = desc.match(/(\d+\.?\d*)\s+shares?/i);
  return m ? parseFloat(m[1]) : null;
}

function extractEntries(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = {
    date: headers.indexOf('date'),
    transaction: headers.indexOf('transaction'),
    description: headers.indexOf('description'),
    amount: headers.indexOf('amount'),
  };
  if (idx.date < 0 || idx.transaction < 0 || idx.description < 0 || idx.amount < 0) {
    throw new Error('CSV must include columns: date, transaction, description, amount');
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const txType = String(r[idx.transaction] || '').trim().toUpperCase();
    if (!['BUY', 'SELL', 'DIV', 'CONT'].includes(txType)) continue;

    const dateStr = String(r[idx.date] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) continue;

    const rawAmount = Number(String(r[idx.amount] || '').replace(/,/g, ''));
    if (!Number.isFinite(rawAmount)) continue;

    const amount = Math.abs(rawAmount);
    if (amount <= 0) continue;

    const desc = r[idx.description] || '';

    if (txType === 'CONT') {
      out.push({
        date: dateStr.slice(0, 10),
        type: 'CONT',
        amount,
        symbol: null,
        name: null,
        shares: null,
        price_per_share: null,
        raw_description: desc,
      });
      continue;
    }

    const { symbol, name } = parseDescription(desc);
    if (!symbol) continue;

    const shares = parseShares(desc);
    const pricePerShare = shares && shares > 0 ? amount / shares : null;

    out.push({
      date: dateStr.slice(0, 10),
      type: txType,
      amount,
      symbol,
      name,
      shares,
      price_per_share: pricePerShare,
      raw_description: desc,
    });
  }
  return out;
}

// POST /api/imports/wealthsimple/preview
router.post('/wealthsimple/preview', auth, async (req, res) => {
  let conn;
  try {
    const { portfolio_id, csv } = req.body;
    if (!portfolio_id || !csv) {
      return res.status(400).json({ error: 'portfolio_id and csv are required' });
    }

    conn = await pool.getConnection();
    const portfolio = await conn.query(
      'SELECT id, name, type FROM portfolios WHERE id = ? AND user_id = ?',
      [portfolio_id, req.user.id]
    );
    if (portfolio.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    let rows;
    try { rows = parseCsv(csv); }
    catch (e) { return res.status(400).json({ error: 'Failed to parse CSV: ' + e.message }); }

    let entries;
    try { entries = extractEntries(rows); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const existing = await conn.query(
      'SELECT id, symbol, name, quantity FROM holdings WHERE portfolio_id = ?',
      [portfolio_id]
    );
    const bySymbol = new Map(existing.map((h) => [h.symbol.toUpperCase(), h]));
    // Load etf_master for base symbol -> full symbol mapping
    const etfMaster = await conn.query('SELECT * FROM etf_master');
    const masterByBase = new Map(etfMaster.map(e => [e.base_symbol.toUpperCase(), e]));
    const masterBySymbol = new Map(etfMaster.map(e => [e.symbol.toUpperCase(), e]));
    // Build base symbol map from existing holdings as fallback
    const byBaseSymbol = new Map(existing.map((h) => {
      const base = h.symbol.toUpperCase().replace(/\.(TO|NE|V|CN|TSX)$/, '');
      return [base, h];
    }));

    const holdingIds = existing.map((h) => h.id);
    let existingDivKeys = new Set();
    let existingTxKeys = new Set();
    let existingContKeys = new Set();

    if (holdingIds.length > 0) {
      const placeholders = holdingIds.map(() => '?').join(',');
      const dRows = await conn.query(
        `SELECT holding_id, DATE_FORMAT(date, '%Y-%m-%d') AS d, amount
         FROM dividends WHERE holding_id IN (${placeholders})`,
        holdingIds
      );
      existingDivKeys = new Set(
        dRows.map((d) => `${d.holding_id}|${d.d}|${Number(d.amount).toFixed(6)}`)
      );
      const tRows = await conn.query(
        `SELECT holding_id, DATE_FORMAT(date, '%Y-%m-%d') AS d, quantity
         FROM transactions WHERE holding_id IN (${placeholders})`,
        holdingIds
      );
      existingTxKeys = new Set(
        tRows.map((t) => `${t.holding_id}|${t.d}|${Number(t.quantity).toFixed(6)}`)
      );
    }

    // Check existing contributions
    const contRows = await conn.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, amount
       FROM contributions WHERE portfolio_id = ?`,
      [portfolio_id]
    );
    existingContKeys = new Set(
      contRows.map((c) => `${c.d}|${Number(c.amount).toFixed(6)}`)
    );

    const items = entries.map((e, idx) => {
      // Resolve CSV symbol using etf_master first, then fallback to direct/base match
      const csvBase = e.symbol ? e.symbol.replace(/\.(TO|NE|V|CN|TSX)$/, '') : null;
      const masterEntry = e.symbol
        ? (masterBySymbol.get(e.symbol) || masterByBase.get(csvBase) || null)
        : null;
      const resolvedSymbol = masterEntry ? masterEntry.symbol : e.symbol;
      const match = resolvedSymbol ? (bySymbol.get(resolvedSymbol) || byBaseSymbol.get(csvBase) || null) : null;
      // Update e.symbol to use the master symbol (with extension)
      if (masterEntry) e.symbol = masterEntry.symbol;
      let duplicate = false;

      if (e.type === 'CONT') {
        const key = `${e.date}|${Number(e.amount).toFixed(6)}`;
        if (existingContKeys.has(key)) duplicate = true;
      } else if (e.type === 'DIV' && match) {
        const key = `${match.id}|${e.date}|${Number(e.amount).toFixed(6)}`;
        if (existingDivKeys.has(key)) duplicate = true;
      } else if ((e.type === 'BUY' || e.type === 'SELL') && match) {
        const key = `${match.id}|${e.date}|${Number(e.shares || 0).toFixed(6)}`;
        if (existingTxKeys.has(key)) duplicate = true;
      }

      return {
        idx,
        date: e.date,
        type: e.type,
        amount: e.amount,
        symbol: e.symbol,
        name: e.name,
        shares: e.shares,
        price_per_share: e.price_per_share,
        raw_description: e.raw_description,
        holding_id: match ? match.id : null,
        holding_exists: !!match,
        duplicate,
      };
    });

    res.json({
      portfolio: { id: portfolio[0].id, name: portfolio[0].name, type: portfolio[0].type },
      total_rows: entries.length,
      items,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/imports/wealthsimple/commit
router.post('/wealthsimple/commit', auth, async (req, res) => {
  let conn;
  try {
    const { portfolio_id, items } = req.body;
    if (!portfolio_id || !Array.isArray(items)) {
      return res.status(400).json({ error: 'portfolio_id and items are required' });
    }

    conn = await pool.getConnection();
    const portfolio = await conn.query(
      'SELECT id FROM portfolios WHERE id = ? AND user_id = ?',
      [portfolio_id, req.user.id]
    );
    if (portfolio.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const existing = await conn.query(
      'SELECT id, symbol, quantity, average_cost FROM holdings WHERE portfolio_id = ?',
      [portfolio_id]
    );
    const bySymbol = new Map(existing.map((h) => [h.symbol.toUpperCase(), h]));
    const byBaseSymbol = new Map(existing.map((h) => {
      const base = h.symbol.toUpperCase().replace(/\.(TO|NE|V|CN|TSX)$/, '');
      return [base, h];
    }));
    // Load etf_master for symbol resolution
    const etfMasterCommit = await conn.query('SELECT * FROM etf_master');
    const masterByBaseCommit = new Map(etfMasterCommit.map(e => [e.base_symbol.toUpperCase(), e]));
    const masterBySymbolCommit = new Map(etfMasterCommit.map(e => [e.symbol.toUpperCase(), e]));

    let createdHoldings = 0;
    let importedDividends = 0;
    let importedTransactions = 0;
    let importedContributions = 0;
    let skippedDuplicates = 0;
    let skippedInvalid = 0;

    for (const item of items) {
      const type = String(item.type || '').toUpperCase();
      const date = String(item.date || '').slice(0, 10);
      const amount = Number(item.amount);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) {
        skippedInvalid++;
        continue;
      }

      // Handle CONT
      if (type === 'CONT') {
        const dupRows = await conn.query(
          'SELECT id FROM contributions WHERE portfolio_id = ? AND date = ? AND amount = ? LIMIT 1',
          [portfolio_id, date, amount]
        );
        if (dupRows.length > 0) { skippedDuplicates++; continue; }

        await conn.query(
          `INSERT INTO contributions (portfolio_id, date, amount, notes)
           VALUES (?, ?, ?, 'Imported from Wealthsimple CSV')`,
          [portfolio_id, date, amount]
        );
        importedContributions++;
        continue;
      }

      const symbol = String(item.symbol || '').trim().toUpperCase();
      if (!symbol) { skippedInvalid++; continue; }

      // Get or create holding
      const csvBaseSymbol = symbol ? symbol.replace(/\.(TO|NE|V|CN|TSX)$/, '') : null;
      // Resolve symbol using etf_master
      const masterEntryCommit = masterBySymbolCommit.get(symbol) || masterByBaseCommit.get(csvBaseSymbol);
      const resolvedSym = masterEntryCommit ? masterEntryCommit.symbol : symbol;
      let holding = bySymbol.get(resolvedSym) || byBaseSymbol.get(csvBaseSymbol);
      let holdingId;
      if (!holding) {
        const ins = await conn.query(
          "INSERT INTO holdings (portfolio_id, symbol, name, type, quantity, average_cost) VALUES (?, ?, ?, 'ETF', 0, 0)",
          [portfolio_id, symbol, item.name || null]
        );
        holdingId = Number(ins.insertId);
        holding = { id: holdingId, symbol, quantity: 0, average_cost: 0 };
        bySymbol.set(symbol, holding);
        createdHoldings++;
      } else {
        holdingId = holding.id;
      }

      if (type === 'DIV') {
        const dupRows = await conn.query(
          'SELECT id FROM dividends WHERE holding_id = ? AND date = ? AND amount = ? LIMIT 1',
          [holdingId, date, amount]
        );
        if (dupRows.length > 0) { skippedDuplicates++; continue; }

        await conn.query(
          `INSERT INTO dividends (holding_id, amount, date, frequency, tax_withheld, notes)
           VALUES (?, ?, ?, 'monthly', 0, 'Imported from Wealthsimple CSV')`,
          [holdingId, amount, date]
        );
        importedDividends++;

      } else if (type === 'BUY' || type === 'SELL') {
        const shares = Number(item.shares || 0);
        const price = Number(item.price_per_share || 0);
        if (shares <= 0) { skippedInvalid++; continue; }

        const dupRows = await conn.query(
          'SELECT id FROM transactions WHERE holding_id = ? AND date = ? AND quantity = ? LIMIT 1',
          [holdingId, date, shares]
        );
        if (dupRows.length > 0) { skippedDuplicates++; continue; }

        const total = shares * price;
        await conn.query(
          `INSERT INTO transactions (holding_id, type, quantity, price, commission, total, date, notes)
           VALUES (?, ?, ?, ?, 0, ?, ?, 'Imported from Wealthsimple CSV')`,
          [holdingId, type, shares, price, total, date]
        );

        let newQty = Number(holding.quantity);
        let newAvgCost = Number(holding.average_cost);
        if (type === 'BUY') {
          const totalCost = newQty * newAvgCost + shares * price;
          newQty += shares;
          newAvgCost = newQty > 0 ? totalCost / newQty : 0;
        } else {
          newQty = Math.max(0, newQty - shares);
        }
        await conn.query(
          'UPDATE holdings SET quantity = ?, average_cost = ? WHERE id = ?',
          [newQty, newAvgCost, holdingId]
        );
        holding.quantity = newQty;
        holding.average_cost = newAvgCost;
        importedTransactions++;
      }
    }

    res.json({
      imported_contributions: importedContributions,
      imported_dividends: importedDividends,
      imported_transactions: importedTransactions,
      skipped_duplicates: skippedDuplicates,
      skipped_invalid: skippedInvalid,
      created_holdings: createdHoldings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/imports/contributions/:portfolio_id
// Returns contributions grouped by year for TFSA tracking
router.get('/contributions/:portfolio_id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const portfolio = await conn.query(
      'SELECT id, name, type FROM portfolios WHERE id = ? AND user_id = ?',
      [req.params.portfolio_id, req.user.id]
    );
    if (portfolio.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const rows = await conn.query(
      `SELECT
         YEAR(date) AS year,
         SUM(amount) AS total,
         COUNT(*) AS count,
         MIN(date) AS first_date,
         MAX(date) AS last_date
       FROM contributions
       WHERE portfolio_id = ?
       GROUP BY YEAR(date)
       ORDER BY year DESC`,
      [req.params.portfolio_id]
    );

    const detail = await conn.query(
      `SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS date, amount, notes
       FROM contributions WHERE portfolio_id = ?
       ORDER BY date DESC`,
      [req.params.portfolio_id]
    );

    res.json({
      portfolio: { id: portfolio[0].id, name: portfolio[0].name, type: portfolio[0].type },
      by_year: rows,
      detail,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
