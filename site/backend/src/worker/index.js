require('dotenv').config();
const cron = require('node-cron');
const { pool } = require('../config/db');

const YAHOO_CHART_URL = 'https://query2.finance.yahoo.com/v8/finance/chart';
const ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query';
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioWorker/1.0)' };
const CA_SUFFIXES = ['.TO', '.NE', '.V', '.CN'];
const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

async function fetchYahooMeta(symbol) {
  const res = await fetch(
    `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`Yahoo API returned ${res.status}`);
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error('No data returned');
  return result.meta;
}

function getBestYahooPrice(meta) {
  if (meta.regularMarketPrice && meta.regularMarketPrice > 0)
    return { price: meta.regularMarketPrice, source: 'yahoo-live' };
  if (meta.previousClose && meta.previousClose > 0)
    return { price: meta.previousClose, source: 'yahoo-close' };
  if (meta.chartPreviousClose && meta.chartPreviousClose > 0)
    return { price: meta.chartPreviousClose, source: 'yahoo-prev' };
  throw new Error('No valid price in Yahoo response');
}

async function fetchAlphaVantagePrice(symbol) {
  if (!ALPHA_KEY) throw new Error('No Alpha Vantage key configured');
  // Strip exchange suffix for Alpha Vantage (it uses symbol only)
  const baseSymbol = symbol.split('.')[0];
  const url = `${ALPHA_VANTAGE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Alpha Vantage returned ${res.status}`);
  const data = await res.json();

  // Check for rate limit message
  if (data.Note || data.Information) {
    throw new Error('Alpha Vantage rate limit reached');
  }

  const quote = data['Global Quote'];
  if (!quote || !quote['05. price']) {
    // Try with .TO suffix for Canadian stocks
    if (!symbol.includes('.')) {
      const toUrl = `${ALPHA_VANTAGE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(baseSymbol + '.TO')}&apikey=${ALPHA_KEY}`;
      const toRes = await fetch(toUrl, { signal: AbortSignal.timeout(15000) });
      const toData = await toRes.json();
      const toQuote = toData['Global Quote'];
      if (toQuote && toQuote['05. price']) {
        const price = parseFloat(toQuote['05. price']);
        if (price > 0) return { price, source: 'alphavantage' };
      }
    }
    throw new Error('No price in Alpha Vantage response');
  }

  const price = parseFloat(quote['05. price']);
  if (!price || price <= 0) throw new Error('Invalid price from Alpha Vantage');
  return { price, source: 'alphavantage' };
}

async function fetchPriceWithFallback(symbol) {
  // 1. Try Yahoo with original symbol
  try {
    const meta = await fetchYahooMeta(symbol);
    const { price, source } = getBestYahooPrice(meta);
    return { price, source, resolvedSymbol: symbol };
  } catch (yahooErr) {
    // 2. Try Yahoo with Canadian exchange suffixes
    if (yahooErr.message.includes('404') && !symbol.includes('.')) {
      for (const suffix of CA_SUFFIXES) {
        try {
          const suffixSymbol = symbol + suffix;
          const meta = await fetchYahooMeta(suffixSymbol);
          const { price, source } = getBestYahooPrice(meta);
          return { price, source, resolvedSymbol: suffixSymbol, saveResolved: true };
        } catch {
          continue;
        }
      }
    }

    // 3. Fall back to Alpha Vantage
    console.log(`Yahoo failed for ${symbol} (${yahooErr.message}), trying Alpha Vantage...`);
    try {
      const { price, source } = await fetchAlphaVantagePrice(symbol);
      return { price, source, resolvedSymbol: symbol };
    } catch (avErr) {
      throw new Error(`Yahoo: ${yahooErr.message} | AlphaVantage: ${avErr.message}`);
    }
  }
}

console.log('Portfolio price worker started');

async function updatePrices() {
  let conn;
  try {
    conn = await pool.getConnection();
    const holdings = await conn.query('SELECT DISTINCT symbol FROM holdings');

    if (holdings.length === 0) {
      console.log('No holdings to update');
      return;
    }

    console.log(`Updating prices for ${holdings.length} symbols...`);

    for (const holding of holdings) {
      try {
        const { price, source, resolvedSymbol, saveResolved } = await fetchPriceWithFallback(holding.symbol);

        await conn.query(
          'UPDATE holdings SET current_price = ?, price_updated_at = NOW() WHERE symbol = ?',
          [price, holding.symbol]
        );
        await conn.query(
          'INSERT INTO price_history (symbol, price) VALUES (?, ?)',
          [holding.symbol, price]
        );

        if (saveResolved && resolvedSymbol !== holding.symbol) {
          await conn.query(
            'UPDATE holdings SET symbol = ? WHERE symbol = ?',
            [resolvedSymbol, holding.symbol]
          );
          console.log(`Resolved ${holding.symbol} → ${resolvedSymbol}: $${price} [${source}]`);
        } else {
          console.log(`Updated ${holding.symbol}: $${price} [${source}]`);
        }

        // Small delay between Alpha Vantage calls to avoid rate limiting
        if (source === 'alphavantage') {
          await new Promise(r => setTimeout(r, 12000)); // 5 calls/min limit
        }
      } catch (err) {
        console.error(`Failed to update ${holding.symbol}: ${err.message}`);
      }
    }

    console.log('Price update complete');
  } catch (err) {
    console.error('Worker error:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

cron.schedule('*/15 * * * *', () => {
  console.log(`[${new Date().toISOString()}] Running scheduled price update`);
  updatePrices();
});

updatePrices();
