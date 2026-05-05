const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');

const EPS = 1e-9;

// Walks all transactions for a holding in chronological order, applying
// Canadian Adjusted Cost Base (ACB) rules:
//   BUY:  totalCost += qty*price + commission;  qty += sold;       acb = totalCost/qty
//   SELL: realized_pnl = (qty*price - commission) - qty*acb;
//         totalCost  -= qty*acb;                  qty -= sold      acb unchanged
// Updates the holdings row with the final qty + avg_cost, and writes
// realized_pnl back onto each SELL transaction.
// Throws if a SELL would push qty negative at any point in the walk.
async function recalcHolding(conn, holdingId) {
  const txns = await conn.query(
    `SELECT id, type, quantity, price, commission, date
     FROM transactions WHERE holding_id = ?
     ORDER BY date ASC, id ASC`,
    [holdingId]
  );

  let qty = 0;
  let totalCost = 0;
  const sellUpdates = [];

  for (const t of txns) {
    const tQty = Number(t.quantity);
    const tPrice = Number(t.price);
    const tComm = Number(t.commission || 0);

    if (t.type === 'BUY') {
      totalCost += tQty * tPrice + tComm;
      qty += tQty;
    } else if (t.type === 'SELL') {
      if (tQty > qty + EPS) {
        const dateStr = t.date instanceof Date ? t.date.toISOString().slice(0, 10) : String(t.date);
        throw new Error(
          `Sell on ${dateStr} for ${tQty} shares but only ${qty.toFixed(6)} held at that point`
        );
      }
      const acb = qty > 0 ? totalCost / qty : 0;
      const proceeds = tQty * tPrice - tComm;
      const costOfSold = tQty * acb;
      const realizedPnl = proceeds - costOfSold;
      sellUpdates.push({ id: t.id, realizedPnl });
      totalCost -= costOfSold;
      qty -= tQty;
      if (qty < EPS) qty = 0;
      if (totalCost < EPS) totalCost = 0;
    }
  }

  const avgCost = qty > 0 ? totalCost / qty : 0;
  await conn.query(
    'UPDATE holdings SET quantity = ?, average_cost = ? WHERE id = ?',
    [qty, avgCost, holdingId]
  );
  for (const u of sellUpdates) {
    await conn.query('UPDATE transactions SET realized_pnl = ? WHERE id = ?', [u.realizedPnl, u.id]);
  }

  return { qty, avgCost };
}

// Get transactions for a holding
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
      'SELECT * FROM transactions WHERE holding_id = ? ORDER BY date DESC, id DESC',
      [req.params.holdingId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Get all transactions for a portfolio
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
      `SELECT t.*, h.symbol, h.name AS holding_name
       FROM transactions t
       JOIN holdings h ON h.id = t.holding_id
       WHERE h.portfolio_id = ?
       ORDER BY t.date DESC, t.id DESC`,
      [req.params.portfolioId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Create transaction (BUY or SELL)
router.post('/', auth, async (req, res) => {
  let conn;
  try {
    const { holding_id, type, quantity, price, commission, date, notes } = req.body;
    const txType = String(type || 'BUY').toUpperCase();
    if (!['BUY', 'SELL'].includes(txType)) {
      return res.status(400).json({ error: 'type must be BUY or SELL' });
    }
    if (!holding_id || !quantity || !price || !date) {
      return res.status(400).json({ error: 'holding_id, quantity, price, and date are required' });
    }
    if (Number(quantity) <= 0 || Number(price) <= 0) {
      return res.status(400).json({ error: 'Quantity and price must be positive' });
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

    const commissionAmt = Number(commission) || 0;
    // For BUY, "total" is cash out (cost basis added). For SELL, it's net proceeds in.
    const total = txType === 'BUY'
      ? (Number(quantity) * Number(price) + commissionAmt)
      : (Number(quantity) * Number(price) - commissionAmt);

    await conn.beginTransaction();

    const result = await conn.query(
      `INSERT INTO transactions
         (holding_id, type, quantity, price, commission, total, date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [holding_id, txType, quantity, price, commissionAmt, total, date, notes || null]
    );

    try {
      await recalcHolding(conn, holding_id);
    } catch (recalcErr) {
      await conn.rollback();
      return res.status(400).json({ error: recalcErr.message });
    }

    await conn.commit();

    res.status(201).json({
      id: Number(result.insertId),
      holding_id,
      type: txType,
      quantity: Number(quantity),
      price: Number(price),
      commission: commissionAmt,
      total,
      date,
      notes: notes || null,
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Delete transaction (recalculates holding; rejects if it would leave the
// holding in an inconsistent state, e.g. removing a buy that an existing sell
// depends on).
router.delete('/:id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const txn = await conn.query(
      `SELECT t.*, p.user_id FROM transactions t
       JOIN holdings h ON h.id = t.holding_id
       JOIN portfolios p ON p.id = h.portfolio_id
       WHERE t.id = ?`,
      [req.params.id]
    );
    if (txn.length === 0 || Number(txn[0].user_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const holdingId = txn[0].holding_id;

    await conn.beginTransaction();
    await conn.query('DELETE FROM transactions WHERE id = ?', [req.params.id]);
    try {
      await recalcHolding(conn, holdingId);
    } catch (recalcErr) {
      await conn.rollback();
      return res.status(400).json({ error: 'Cannot delete: ' + recalcErr.message });
    }
    await conn.commit();

    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
