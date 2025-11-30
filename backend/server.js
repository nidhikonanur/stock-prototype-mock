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

// -------------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// -------------------------------------------------------------
// QUOTE ROUTE
// -------------------------------------------------------------
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();

  try {
    // MOCK MODE
    if (MOCK) {
      const file = path.join(__dirname, 'sample_data', 'sample_quote.json');
      if (!fs.existsSync(file)) {
        return res.status(500).json({ error: 'sample_quote.json missing' });
      }
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.symbol = symbol;
      return res.json(data);
    }

    // LIVE MODE
    if (!KEY) {
      return res.status(500).json({ error: 'FINNHUB_KEY not configured' });
    }

    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${KEY}`;
    const r = await fetch(url);
    const data = await r.json();

    return res.json({ symbol, data });
  } catch (err) {
    console.error("QUOTE ERROR:", err);
    return res.status(500).json({ error: "failed to fetch quote", details: err.message });
  }
});

// -------------------------------------------------------------
// RECOMMENDATION ROUTE
// -------------------------------------------------------------
app.get('/api/recommend', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();

  try {
    // 1) MOCK MODE
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

    // 2) LIVE MODE
    if (!KEY) {
      return res.status(500).json({ error: 'FINNHUB_KEY not configured' });
    }

    // FIRST fetch the quote so we get Finnhub's own timestamp
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${KEY}`;
    let qr = await fetch(quoteUrl);
    let qj = await qr.json();

    // Use FINNHUB'S timestamp → solves future-date issues
    const now = (qj && qj.
