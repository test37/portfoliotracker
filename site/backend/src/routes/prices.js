const router = require('express').Router();
const { pool } = require('../config/db');
const auth = require('../middleware/auth');

const YAHOO_CHART_URL = 'https://query2.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query2.finance.yahoo.com/v1/finance/search';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioAPI/1.0)' };
const CA_SUFFIXES = ['.TO', '.NE', '.V', '.CN'];

async function fetchYahooData(symbol, range = '6mo') {
  const res = await fetch(
    `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=1mo&range=${range}&events=dividends`,
    { headers: HEADERS, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`Yahoo API returned ${res.status}`);
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error('No data returned');
  return result;
}

function getBestPrice(meta) {
  if (meta.regularMarketPrice && meta.regularMarketPrice > 0)
    return { price: meta.regularMarketPrice, source: 'yahoo-live' };
  if (meta.previousClose && meta.previousClose > 0)
    return { price: meta.previousClose, source: 'yahoo-close' };
  if (meta.chartPreviousClose && meta.chartPreviousClose > 0)
    return { price: meta.chartPreviousClose, source: 'yahoo-prev' };
  throw new Error('No valid price found');
}

async function getAlphaKey(userId) {
  // Try user settings first, fall back to environment
  if (userId) {
    try {
      const { pool } = require('../config/db');
      let conn;
      try {
        conn = await pool.getConnection();
        const rows = await conn.query(
          'SELECT alpha_vantage_key FROM user_settings WHERE user_id = ?',
          [userId]
        );
        if (rows.length > 0 && rows[0].alpha_vantage_key) return rows[0].alpha_vantage_key;
      } finally {
        if (conn) conn.release();
      }
    } catch (err) {
      console.error('Failed to load Alpha Vantage key from DB:', err.message);
    }
  }
  return process.env.ALPHA_VANTAGE_KEY || null;
}

async function fetchAlphaVantagePrice(symbol, userId) {
  const ALPHA_KEY = await getAlphaKey(userId);
  if (!ALPHA_KEY) throw new Error('No Alpha Vantage key');
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Alpha Vantage returned ${res.status}`);
  const data = await res.json();
  if (data.Note || data.Information) throw new Error('Alpha Vantage rate limit');
  const quote = data['Global Quote'];
  if (!quote || !quote['05. price']) throw new Error('No price in Alpha Vantage');
  const price = parseFloat(quote['05. price']);
  if (!price || price <= 0) throw new Error('Invalid price');
  return { price, source: 'alphavantage', previousClose: parseFloat(quote['08. previous close']) };
}

async function fetchPriceWithFallback(symbol) {
  try {
    const result = await fetchYahooData(symbol);
    const { price, source } = getBestPrice(result.meta);
    return { result, price, source, resolvedSymbol: symbol };
  } catch (err) {
    if (err.message.includes('404') && !symbol.includes('.')) {
      for (const suffix of CA_SUFFIXES) {
        try {
          const suffixSymbol = symbol + suffix;
          const result = await fetchYahooData(suffixSymbol);
          const { price, source } = getBestPrice(result.meta);
          return { result, price, source, resolvedSymbol: suffixSymbol, saveResolved: true };
        } catch { continue; }
      }
    }
    try {
      const av = await fetchAlphaVantagePrice(symbol);
      return { result: null, price: av.price, source: av.source, resolvedSymbol: symbol };
    } catch (avErr) {
      throw new Error(`Yahoo: ${err.message} | AV: ${avErr.message}`);
    }
  }
}

function parseDateUTC(dateStr) {
  const [yr, mo, dy] = dateStr.trim().split('-').map(Number);
  return Date.UTC(yr, mo - 1, dy) / 1000;
}

function parseDividends(events, currentPrice) {
  const divs = events?.dividends || {};
  const now = Date.now() / 1000;
  const threeMonthsAgo = now - (90 * 24 * 3600);
  const twoMonthsAhead = now + (60 * 24 * 3600);

  const allDivs = Object.values(divs).map(d => ({
    date: new Date(d.date * 1000).toISOString().slice(0, 10),
    amount: d.amount,
    timestamp: d.date,
    isFuture: d.date > now,
    isEstimated: d.date > now,
  })).sort((a, b) => b.timestamp - a.timestamp);

  const past3Months = allDivs.filter(d => d.timestamp >= threeMonthsAgo && d.timestamp <= now);
  const future2Months = allDivs.filter(d => d.timestamp > now && d.timestamp <= twoMonthsAhead);

  const recentDivs = allDivs.filter(d => !d.isFuture).slice(0, 12);
  const avgDiv = recentDivs.length > 0
    ? recentDivs.reduce((s, d) => s + d.amount, 0) / recentDivs.length
    : 0;

  let frequency = 12;
  if (recentDivs.length >= 2) {
    const avgDaysBetween = recentDivs.slice(0, -1).reduce((s, d, i) => {
      return s + Math.abs(d.timestamp - recentDivs[i + 1].timestamp) / (24 * 3600);
    }, 0) / (recentDivs.length - 1);
    if (avgDaysBetween <= 10)       frequency = 52;
    else if (avgDaysBetween <= 18)  frequency = 26;
    else if (avgDaysBetween <= 22)  frequency = 24;
    else if (avgDaysBetween <= 45)  frequency = 12;
    else if (avgDaysBetween <= 80)  frequency = 6;
    else if (avgDaysBetween <= 100) frequency = 4;
    else if (avgDaysBetween <= 200) frequency = 2;
    else                            frequency = 1;
  }

  const annualDiv = avgDiv * frequency;
  const yieldPct = currentPrice > 0 ? (annualDiv / currentPrice) * 100 : 0;

  return { past3Months, future2Months, annualDiv, yieldPct, frequency, avgDiv };
}

function parseMonthlyPrices(result, months = 3) {
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps.slice(-months).map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 7),
    price: closes[closes.length - months + i],
  })).filter(p => p.price != null);
}

async function fetchDividendHistory(symbol) {
  const baseSymbol = symbol.replace(/\.(TO|NE|V|CN)$/i, '');
  const urls = [
    `https://dividendhistory.org/payout/tsx/${baseSymbol}/`,
    `https://dividendhistory.org/payout/neo/${baseSymbol}/`,
    `https://dividendhistory.org/payout/${baseSymbol}/`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Parse frequency
      const freqMatch = html.match(/Frequency<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/i);
      const freqText = freqMatch ? freqMatch[1].trim().toLowerCase() : '';

      let frequency = 12;
      if (freqText.includes('semi-monthly') || freqText.includes('bi-monthly')) frequency = 24;
      else if (freqText.includes('weekly')) frequency = 52;
      else if (freqText.includes('fortnightly') || freqText.includes('bi-weekly')) frequency = 26;
      else if (freqText.includes('quarterly')) frequency = 4;
      else if (freqText.includes('semi-annual')) frequency = 2;
      else if (freqText.includes('annual') && !freqText.includes('semi')) frequency = 1;
      else if (freqText.includes('monthly')) frequency = 12;

      // Parse annual dividend
      const annualMatch = html.match(/Annual Dividend<\/dt>\s*<dd[^>]*>\s*\$([\d.]+)/i);
      const annualDiv = annualMatch ? parseFloat(annualMatch[1]) : 0;

      // Parse dividend table — id="dividend-table"
      const tableMatch = html.match(/<table[^>]*id="dividend-table"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
      const rows = [];
      if (tableMatch) {
        const rowMatches = [...tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        for (const row of rowMatches) {
          const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
            .map(c => c[1].replace(/<[^>]+>/g, '').replace(/[*\s]+/g, ' ').trim());
          if (cells.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(cells[0])) {
            const amount = parseFloat(cells[2].replace(/[^\d.]/g, ''));
            if (!isNaN(amount) && amount > 0) {
              const timestamp = parseDateUTC(cells[0]);
              const isEstimated = (cells[3] || '').toLowerCase().includes('unconfirmed') ||
                                  (cells[3] || '').toLowerCase().includes('estimated');
              rows.push({ date: cells[0], payDate: cells[1], amount, timestamp, isEstimated });
            }
          }
        }
      }

      if (freqText === '' && rows.length === 0 && annualDiv === 0) continue;

      const now = Date.now() / 1000;
      const past3Months = rows.filter(r => r.timestamp >= now - 90 * 86400 && r.timestamp <= now);
      const future2Months = rows.filter(r => r.timestamp > now && r.timestamp <= now + 60 * 86400);
      const avgDiv = annualDiv > 0
        ? annualDiv / frequency
        : rows.length > 0 ? rows.slice(0, 3).reduce((s, r) => s + r.amount, 0) / Math.min(rows.length, 3) : 0;

      console.log(`dividendhistory: ${symbol} freq=${frequency} annual=${annualDiv} rows=${rows.length} past3=${past3Months.length} future2=${future2Months.length}`);
      return { frequency, annualDiv: annualDiv || avgDiv * frequency, avgDiv, past3Months, future2Months, source: 'dividendhistory' };
    } catch (e) {
      console.log(`dividendhistory error for ${url}: ${e.message}`);
      continue;
    }
  }
  throw new Error('dividendhistory.org: not found');
}

// GET /api/prices/detail/:symbol
router.get('/detail/:symbol', auth, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { result, price, source, resolvedSymbol } = await fetchPriceWithFallback(symbol);

    if (!result) {
      return res.json({ symbol, resolvedSymbol, price, source });
    }

    const meta = result.meta;
    let divData = parseDividends(result.events, price);
    const monthlyPrices = parseMonthlyPrices(result, 3);

    // Fallback to dividendhistory.org if Yahoo has no or insufficient dividend data
    // Trigger if: no dividends at all, OR less than 4 past dividends (not enough for frequency detection)
    if (divData.past3Months.length === 0 || divData.past3Months.length < 3) {
      try {
        const dh = await fetchDividendHistory(resolvedSymbol);
        divData = {
          past3Months: dh.past3Months,
          future2Months: dh.future2Months,
          annualDiv: dh.annualDiv,
          yieldPct: price > 0 ? (dh.annualDiv / price) * 100 : 0,
          frequency: dh.frequency,
          avgDiv: dh.avgDiv,
        };
      } catch (dhErr) {
        console.log(`dividendhistory fallback failed for ${resolvedSymbol}: ${dhErr.message}`);
      }
    }

    res.json({
      symbol: resolvedSymbol,
      name: meta.shortName || meta.longName,
      price,
      source,
      currency: meta.currency,
      previousClose: meta.previousClose,
      change: price - (meta.previousClose || price),
      changePercent: meta.previousClose ? ((price - meta.previousClose) / meta.previousClose * 100) : 0,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      marketState: meta.marketState,
      exchange: meta.exchangeName,
      annualDividend: divData.annualDiv,
      yieldPct: divData.yieldPct,
      frequency: divData.frequency,
      avgMonthlyDiv: divData.avgDiv,
      past3MonthsDividends: divData.past3Months,
      future2MonthsDividends: divData.future2Months,
      monthlyPrices,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices/:symbol
router.get('/:symbol', auth, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { result, price, source, resolvedSymbol } = await fetchPriceWithFallback(symbol);
    const meta = result?.meta || {};
    res.json({
      symbol: resolvedSymbol,
      price,
      source,
      currency: meta.currency,
      previousClose: meta.previousClose,
      change: price - (meta.previousClose || price),
      changePercent: meta.previousClose ? ((price - meta.previousClose) / meta.previousClose * 100) : 0,
      name: meta.shortName || meta.longName,
      exchange: meta.exchangeName,
      marketState: meta.marketState,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices/history/:symbol
router.get('/history/:symbol', auth, async (req, res) => {
  let conn;
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT * FROM price_history WHERE symbol = ? ORDER BY fetched_at DESC LIMIT ?',
      [req.params.symbol.toUpperCase(), limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/prices/refresh
router.post('/refresh', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const holdings = await conn.query(
      `SELECT DISTINCT h.symbol FROM holdings h
       JOIN portfolios p ON p.id = h.portfolio_id
       WHERE p.user_id = ?`,
      [req.user.id]
    );
    const results = [];
    for (const h of holdings) {
      try {
        const { price, source, resolvedSymbol } = await fetchPriceWithFallback(h.symbol);
        await conn.query(
          'UPDATE holdings SET current_price = ?, price_updated_at = NOW() WHERE symbol = ?',
          [price, h.symbol]
        );
        await conn.query(
          'INSERT INTO price_history (symbol, price) VALUES (?, ?)',
          [h.symbol, price]
        );
        results.push({ symbol: h.symbol, resolvedSymbol, price, source, status: 'updated' });
        if (source === 'alphavantage') await new Promise(r => setTimeout(r, 12000));
      } catch (err) {
        results.push({ symbol: h.symbol, error: err.message, status: 'failed' });
      }
    }
    res.json({ updated: results.filter(r => r.status === 'updated').length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/prices/search/:query
router.get('/search/:query', auth, async (req, res) => {
  try {
    const searchRes = await fetch(
      `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(req.params.query)}&quotesCount=10&newsCount=0`,
      { headers: HEADERS, signal: AbortSignal.timeout(10000) }
    );
    if (!searchRes.ok) throw new Error(`Yahoo search returned ${searchRes.status}`);
    const data = await searchRes.json();
    const quotes = (data.quotes || []).map(q => ({
      symbol: q.symbol,
      name: q.shortname || q.longname,
      type: q.typeDisp || q.quoteType,
      exchange: q.exchDisp || q.exchange,
    }));
    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
