require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { recommendationFromCloses } = require('./recommend');

const app = express();
app.use(cors());

const KEY = process.env.FINNHUB_KEY;
const PORT = process.env.PORT || 3001;
const MOCK = process.env.MOCK === 'true';

// --- Health route (guarantees /api/health works) ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// --- Quote route (mock or live) ---
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  try {
    if (MOCK) {
      const p = path.join(__dirname, 'sample_data', 'sample_quote.json');
      if (!fs.existsSync(p)) return res.status(500).json({ error: 'sample_quote.json missing' });
      const raw = fs.readFileSync(p, 'utf8');
      const j = JSON.parse(raw);
      j.symbol = symbol;
      return res.json(j);
    }

    if (!KEY) return res.status(500).json({ error: 'FINNHUB_KEY not configured' });
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    return res.json({ symbol, data });
  } catch (err) {
    console.error('quote error', err);
    return res.status(500).json({ error: 'failed to fetch quote', details: err.message });
  }
});

// --- Recommend route (mock or live) ---
if (!KEY) return res.status(500).json({ error: 'FINNHUB_KEY not configured' });

const now = Math.floor(Date.now() / 1000);
const from = now - 220 * 24 * 3600;

// 1️⃣ Try DAILY candles first
const dailyUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${KEY}`;
let r = await fetch(dailyUrl);
let j = await r.json();

let closes = null;

if (j && j.s === "ok" && Array.isArray(j.c) && j.c.length >= 200) {
  closes = j.c;
} else {
  // 2️⃣ DAILY failed → fallback to WEEKLY candles
  const weeklyUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=W&from=${from}&to=${now}&token=${KEY}`;
  r = await fetch(weeklyUrl);
  j = await r.json();

  if (j && j.s === "ok" && Array.isArray(j.c) && j.c.length >= 50) {
    // Weekly candles (need fewer points for MA because each W = 5D)
    closes = j.c;
  } else {
    return res.status(500).json({
      error: "failed to fetch historical data from Finnhub",
      details: j
    });
  }
}

// 3️⃣ Run recommendation
const rec = recommendationFromCloses(closes);
return res.json({ symbol, rec });


    if (!KEY) return res.status(500).json({ error: 'FINNHUB_KEY not configured' });
    const now = Math.floor(Date.now() / 1000);
    const from = now - 220 * 24 * 3600;
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${KEY}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!j || j.s !== 'ok' || !Array.isArray(j.c)) {
      return res.status(500).json({ error: 'failed to fetch historical data', details: j });
    }
    const rec = recommendationFromCloses(j.c);
    return res.json({ symbol, rec });
  } catch (err) {
    console.error('recommend error', err);
    return res.status(500).json({ error: 'failed to compute recommendation', details: err.message });
  }
});

// --- Serve static frontend if present (optional) ---
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
}

app.listen(PORT, () => console.log('Backend running', PORT, 'MOCK=' + MOCK));
