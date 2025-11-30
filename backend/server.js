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
// HEALTH CHECK
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// -------------------------------------------------------------
// QUOTE ROUTE  (Alpha Vantage GLOBAL QUOTE)
// -------------------------------------------------------------
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();

  try {
    if (MOCK) {
      const file = path.join(__dirname, 'sample_data', 'sample_quote.json');
      if (!fs.existsSync(file)) {
        return res.status(500).json({ error: 'sample_quote.json missing' });
      }
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.symbol = symbol;
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

    return res.json({
      symbol,
      data: {
        c: Number(q['05. price']),
        o: Number(q['02. open']),
        h: Number(q['03. high']),
        l: Number(q['04. low']),
        pc: Number(q['08. previous close']),
        t: Date.now() / 1000 // Alpha Vantage does not return timestamp; use now
      }
    });

  } catch (err) {
    console.error("QUOTE ERROR:", err);
    return res.status(500).json({ error: "failed to fetch quote", details: err.message });
  }
});

// -------------------------------------------------------------
// RECOMMENDATION ROUTE — DAILY ADJUSTED (RELIABLE)
// -------------------------------------------------------------
app.get('/api/recommend', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();

  try {
    if (MOCK) {
      const file = path.join(__dirname, 'sample_data', 'sample_candles.json');
      if (!fs.existsSync(file)) {
        return res.status(500).json({ error: 'sample_candles.json missing' });
      }
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!j || !Array.isArray(j.c)) {
        return res.status(500).json({ error: 'invalid sample candles' });
      }
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

    // Extract closes (sorted newest → oldest)
    const closes = Object.values(series)
      .map(d => Number(d['4. close']))
      .filter(n => !isNaN(n));

    if (closes.length < 200) {
      return res.status(500).json({ error: "Not enough history returned", count: closes.length });
    }

    // Reverse so oldest → newest
    closes.reverse();

    const rec = recommendationFromCloses(closes);

    return res.json({ symbol, rec, source: "alpha_vantage_daily" });

  } catch (err) {
    console.error("RECOMMEND ERROR:", err);
    return res.status(500).json({ error: "failed to compute recommendation", details: err.message });
  }
});

// -------------------------------------------------------------
// SERVE STATIC FRONTEND (OPTIONAL)
// -------------------------------------------------------------
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('/', (req, res) =>
    res.sendFile(path.join(publicPath, 'index.html'))
  );
}

// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT} | MOCK=${MOCK}`);
});
