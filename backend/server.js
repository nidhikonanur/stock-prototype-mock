require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { recommendationFromCloses } = require('./recommend');

const app = express();
app.use(cors());

const ALPHA_KEY = process.env.ALPHA_KEY;
const PORT = process.env.PORT || 3001;
const MOCK = process.env.MOCK === 'true';

// -------------------------------------------------------------
// SIMPLE IN-MEMORY CACHE (fixes rate limiting)
// -------------------------------------------------------------
let quoteCache = {};
let quoteCacheTime = {};

let historyCache = {};
let historyCacheTime = {};

// -------------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// -------------------------------------------------------------
// QUOTE ROUTE  (cached for 30 seconds)
// -------------------------------------------------------------
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();

  // Serve cached quote if < 30s old
  if (quoteCache[symbol] && Date.now() - quoteCacheTime[symbol] < 30000) {
    return res.json(quoteCache[symbol]);
  }

  try {
    if (MOCK) {
      const file = path.join(__dirname, 'sample_data', 'sample_quote.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.symbol = symbol;
      quoteCache[symbol] = data;
      quoteCacheTime[symbol] = Date.now();
      return res.json(data);
    }

    if (!ALPHA_KEY) {
      return res.status(500).json({ error: 'ALPHA_KEY not configured' });
    }

    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_KEY}`;
    const r = await fetch(url);
    const j = await r.json();

    if (!j || !j['Global Quote']) {
      return res.status(500).json({ error: 'Failed to fetch live quote', details: j });
    }

    const q = j['Global Quote'];
    const result = {
      symbol,
      data: {
        c: Number(q['05. price']),
        o: Number(q['02. open']),
        h: Number(q['03. high']),
        l: Number(q['04. low']),
        pc: Number(q['08. previous close']),
        t: Date.now() / 1000
      }
    };

    // Store in cache
    quoteCache[symbol] = result;
    quoteCacheTime[symbol] = Date.now();

    return res.json(result);

  } catch (err) {
    return res.status(500).json({ error: "failed to fetch quote", details: err.message });
  }
});

// -------------------------------------------------------------
// RECOMMENDATION ROUTE — CACHED FOR 12 HOURS
// -------------------------------------------------------------
app.get('/api/recommend', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();

  // If history cached < 12 hours → use it
  if (historyCache[symbol] && Date.now() - historyCacheTime[symbol] < 12 * 60 * 60 * 1000) {
    const closes = historyCache[symbol];
    const rec = recommendationFromCloses(closes);
    return res.json({ symbol, rec, source: "alpha_vantage_cached" });
  }

  try {
    if (MOCK) {
      const file = path.join(__dirname, 'sample_data', 'sample_candles.json');
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rec = recommendationFromCloses(j.c);
      return res.json({ symbol, rec, source: "mock" });
    }

    if (!ALPHA_KEY) {
      return res.status(500).json({ error: 'ALPHA_KEY not configured' });
    }

    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${symbol}&apikey=${ALPHA_KEY}&outputsize=full`;
    const r = await fetch(url);
    const j = await r.json();

    const series = j['Time Series (Daily)'];

    if (!series) {
      return res.status(500).json({ error: "Failed to fetch daily history", details: j });
    }

    // Extract closes
    const closes = Object.values(series)
      .map(d => Number(d['4. close']))
      .filter(n => !isNaN(n))
      .reverse(); // oldest → newest

    if (closes.length < 200) {
      return res.status(500).json({ error: "Not enough history returned", count: closes.length });
    }

    // SAVE TO CACHE
    historyCache[symbol] = closes;
    historyCacheTime[symbol] = Date.now();

    const rec = recommendationFromCloses(closes);

    return res.json({ symbol, rec, source: "alpha_vantage_daily" });

  } catch (err) {
    return res.status(500).json({ error: "failed to compute recommendation", details: err.message });
  }
});

// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT} | MOCK=${MOCK}`);
});
