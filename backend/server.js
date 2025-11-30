require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { recommendationFromCloses } = require('./recommend');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;
const MOCK = process.env.MOCK === 'true';

// Simple in-memory caches
let quoteCache = {};
let historyCache = {};

function cacheGet(cache, key, maxAgeMs) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > maxAgeMs) return null;
  return entry.value;
}

function cacheSet(cache, key, val) {
  cache[key] = { value: val, ts: Date.now() };
}

// ----------------------------
// HEALTH CHECK
// ----------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// ------------------- QUOTE ROUTE (Fully Reliable Yahoo Quote) -------------------
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || "AAPL").toUpperCase();

  // MOCK support
  if (MOCK) {
    const p = path.join(__dirname, "sample_data", "sample_quote.json");
    if (!fs.existsSync(p)) return res.status(500).json({ error: 'sample_quote.json missing' });
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.symbol = symbol;
    return res.json(j);
  }

  // Try cache (< 30s)
  const cached = cacheGet(quoteCache, symbol, 30000);
  if (cached) return res.json(cached);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      },
      timeout: 10000
    });

    const j = await r.json();

    if (!j || !j.chart || !j.chart.result || !j.chart.result[0]) {
      return res.status(500).json({ error: "Yahoo chart returned no data", details: j });
    }

    const result = j.chart.result[0];

    // ensure indicators and timestamps exist
    if (!result.indicators || !result.indicators.quote || !Array.isArray(result.indicators.quote) || !result.timestamp) {
      return res.status(500).json({ error: "Yahoo chart missing indicators or timestamps", details: result });
    }

    const quoteData = result.indicators.quote[0];

    // protect against sparse/null values in arrays
    const closes = Array.isArray(quoteData.close) ? quoteData.close.filter(v => typeof v === "number") : [];
    const opens = Array.isArray(quoteData.open) ? quoteData.open : [];
    const highs = Array.isArray(quoteData.high) ? quoteData.high : [];
    const lows = Array.isArray(quoteData.low) ? quoteData.low : [];
    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];

    if (closes.length === 0 || timestamps.length === 0) {
      return res.status(500).json({ error: "No usable candle data from Yahoo", details: { closesLength: closes.length, timestampsLength: timestamps.length } });
    }

    // Use the last available index referencing the original arrays (not filtered closes)
    // Find last non-null index in quoteData.close
    let lastIndex = -1;
    for (let i = quoteData.close.length - 1; i >= 0; i--) {
      if (typeof quoteData.close[i] === 'number') { lastIndex = i; break; }
    }
    if (lastIndex < 0) {
      return res.status(500).json({ error: "No numeric close value found in candles" });
    }

    // previous index safe guard
    const prevIndex = Math.max(0, lastIndex - 1);

    const safeGet = (arr, idx) => (Array.isArray(arr) && arr.length > idx ? arr[idx] : null);

    const data = {
      symbol,
      data: {
        c: safeGet(quoteData.close, lastIndex),
        o: safeGet(quoteData.open, lastIndex),
        h: safeGet(quoteData.high, lastIndex),
        l: safeGet(quoteData.low, lastIndex),
        pc: safeGet(quoteData.close, prevIndex),
        t: safeGet(timestamps, lastIndex)
      }
    };

    // final sanity: ensure current price is numeric
    if (typeof data.data.c !== 'number') {
      return res.status(500).json({ error: "Quote current price not available", details: data });
    }

    cacheSet(quoteCache, symbol, data);
    return res.json(data);

  } catch (err) {
    console.error("YAHOO QUOTE ERROR:", err && err.message ? err.message : err);
    return res.status(500).json({
      error: "Yahoo quote error",
      details: String(err && err.message ? err.message : err)
    });
  }
});

// ------------------- RECOMMENDATION ROUTE -------------------
app.get('/api/recommend', async (req, res) => {
  const symbol = (req.query.symbol || "AAPL").toUpperCase();

  // MOCK support
  if (MOCK) {
    const p = path.join(__dirname, 'sample_data', 'sample_candles.json');
    if (!fs.existsSync(p)) return res.status(500).json({ error: 'sample_candles.json missing' });
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || !Array.isArray(j.c)) return res.status(500).json({ error: 'invalid sample candles' });
    const rec = recommendationFromCloses(j.c);
    return res.json({ symbol, rec, source: "mock" });
  }

  // Try history cache (< 6 hours)
  const cached = cacheGet(historyCache, symbol, 6 * 60 * 60 * 1000);
  if (cached) {
    const rec = recommendationFromCloses(cached);
    return res.json({ symbol, rec, source: "yahoo_cached" });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      },
      timeout: 15000
    });

    const j = await r.json();

    if (!j || !j.chart || !j.chart.result || !j.chart.result[0]) {
      return res.status(500).json({ error: "Yahoo history returned no data", details: j });
    }

    const result = j.chart.result[0];

    if (!result.indicators || !result.indicators.quote || !Array.isArray(result.indicators.quote)) {
      return res.status(500).json({ error: "Yahoo history missing indicators", details: result });
    }

    const rawCloses = result.indicators.quote[0].close || [];
    const closes = rawCloses.filter(v => typeof v === "number");

    if (closes.length < 200) {
      return res.status(500).json({ error: "Not enough data for MA calculation", count: closes.length });
    }

    // save to cache and compute recommendation
    cacheSet(historyCache, symbol, closes);
    const rec = recommendationFromCloses(closes);
    return res.json({ symbol, rec, source: "yahoo_1y_daily" });

  } catch (err) {
    console.error("YAHOO HISTORY ERROR:", err && err.message ? err.message : err);
    return res.status(500).json({ error: "Yahoo history error", details: String(err && err.message ? err.message : err) });
  }
});

// ------------------- START SERVER -------------------
app.listen(PORT, () => {
  console.log(`Yahoo Finance backend running on ${PORT} | MOCK=${MOCK}`);
});
