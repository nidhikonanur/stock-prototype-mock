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

// ------------------- SIMPLE CACHE -------------------
let quoteCache = {};
let historyCache = {};

function cacheGet(cache, key, maxAgeMs) {
  const item = cache[key];
  if (!item) return null;
  if (Date.now() - item.ts > maxAgeMs) return null;
  return item.value;
}

function cacheSet(cache, key, value) {
  cache[key] = { value, ts: Date.now() };
}

// ------------------- HEALTH ROUTE -------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// ------------------- QUOTE ROUTE -------------------
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || "AAPL").toUpperCase();

  if (MOCK) {
    const p = path.join(__dirname, 'sample_data', 'sample_quote.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.symbol = symbol;
    return res.json(j);
  }

  // Cached quote (< 30 seconds)
  const cached = cacheGet(quoteCache, symbol, 30000);
  if (cached) return res.json(cached);

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
    const r = await fetch(url);
    const j = await r.json();

    if (!j || !j.quoteResponse || j.quoteResponse.result.length === 0) {
      return res.status(500).json({ error: "Failed to fetch Yahoo quote", details: j });
    }

    const q = j.quoteResponse.result[0];

    const data = {
      symbol,
      data: {
        c: q.regularMarketPrice,
        o: q.regularMarketOpen,
        h: q.regularMarketDayHigh,
        l: q.regularMarketDayLow,
        pc: q.regularMarketPreviousClose,
        t: q.regularMarketTime,
      }
    };

    cacheSet(quoteCache, symbol, data);
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: "Yahoo quote error", details: err.message });
  }
});

// ------------------- RECOMMEND ROUTE -------------------
app.get('/api/recommend', async (req, res) => {
  const symbol = (req.query.symbol || "AAPL").toUpperCase();

  if (MOCK) {
    const p = path.join(__dirname, 'sample_data', 'sample_candles.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const rec = recommendationFromCloses(j.c);
    return res.json({ symbol, rec, source: "mock" });
  }

  // Cached history (< 6 hours)
  const cached = cacheGet(historyCache, symbol, 6 * 60 * 60 * 1000);
  if (cached) {
    const rec = recommendationFromCloses(cached);
    return res.json({ symbol, rec, source: "yahoo_cached" });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
    const r = await fetch(url);
    const j = await r.json();

    if (!j || !j.chart || !j.chart.result) {
      return res.status(500).json({ error: "Failed to fetch Yahoo history", details: j });
    }

    const result = j.chart.result[0];
    const closes = result.indicators.quote[0].close.filter((n) => typeof n === 'number');

    if (closes.length < 200) {
      return res.status(500).json({ error: "Not enough data", count: closes.length });
    }

    cacheSet(historyCache, symbol, closes);

    const rec = recommendationFromCloses(closes);
    return res.json({ symbol, rec, source: "yahoo_daily_1y" });

  } catch (err) {
    return res.status(500).json({ error: "Yahoo history error", details: err.message });
  }
});

// ------------------- START SERVER -------------------
app.listen(PORT, () => {
  console.log(`Yahoo Finance backend running on ${PORT} | MOCK=${MOCK}`);
});
