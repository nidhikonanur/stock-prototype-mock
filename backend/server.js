// backend/server.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { recommendationFromCloses } = require('./recommend'); // keep existing

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MOCK = process.env.MOCK === 'true';

// ---------------- simple caches ----------------
let quoteCache = {};   // symbol -> {value, ts}
let historyCache = {}; // symbol -> {value, ts}
let alerts = [];       // {id, symbol, type('gt'|'lt'), price, webhook (optional)}
let portfolio = [];    // {id, symbol, qty}

// cache helpers
function cacheGet(cache, key, maxAgeMs) {
  const e = cache[key];
  if (!e) return null;
  if (Date.now() - e.ts > maxAgeMs) return null;
  return e.value;
}
function cacheSet(cache, key, val) {
  cache[key] = { value: val, ts: Date.now() };
}

// utility: safe numeric arrays
const safeArr = (v) => (Array.isArray(v) ? v : []);

// ---------------- health ----------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// ---------------- reliable yahoo chart fetch ----------------
async function fetchYahooChart(symbol, range='1d', interval='1m') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' } });
  return await r.json();
}

// ---------------- /api/quote (from chart 1d 1m) ----------------
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  if (MOCK) {
    const p = path.join(__dirname, 'sample_data', 'sample_quote.json');
    if (!fs.existsSync(p)) return res.status(500).json({ error: 'sample_quote.json missing' });
    const j = JSON.parse(fs.readFileSync(p, 'utf8')); j.symbol = symbol;
    return res.json(j);
  }

  const cached = cacheGet(quoteCache, symbol, 30000);
  if (cached) return res.json(cached);

  try {
    const j = await fetchYahooChart(symbol,'1d','1m');
    if (!j || !j.chart || !j.chart.result || !j.chart.result[0]) {
      return res.status(500).json({ error:'Yahoo chart returned no data', details:j });
    }
    const r = j.chart.result[0];
    const q = r.indicators && r.indicators.quote && r.indicators.quote[0] ? r.indicators.quote[0] : null;
    if (!q || !Array.isArray(q.close) || !Array.isArray(r.timestamp)) {
      return res.status(500).json({ error:'No candle data', details:r });
    }
    // find last numeric index
    let last = -1;
    for (let i = q.close.length-1; i>=0; i--) if (typeof q.close[i] === 'number') { last = i; break; }
    if (last < 0) return res.status(500).json({ error:'No numeric close found' });

    const prev = Math.max(0, last-1);
    const out = {
      symbol,
      data: {
        c: q.close[last],
        o: q.open[last],
        h: q.high[last],
        l: q.low[last],
        pc: q.close[prev],
        t: (r.timestamp && r.timestamp[last]) ? r.timestamp[last] : Math.floor(Date.now()/1000)
      }
    };
    cacheSet(quoteCache, symbol, out);
    return res.json(out);

  } catch (err) {
    console.error('quote error', err);
    return res.status(500).json({ error:'Yahoo quote error', details:String(err) });
  }
});

// ---------------- /api/history (candles) ----------------
// params: symbol, range (1y,6mo,3mo), interval (1d,1wk,1m)
app.get('/api/history', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  const range = req.query.range || '1y';
  const interval = req.query.interval || '1d';
  if (MOCK) {
    const p = path.join(__dirname,'sample_data','sample_candles.json');
    if (!fs.existsSync(p)) return res.status(500).json({ error:'sample_candles.json missing' });
    return res.json(JSON.parse(fs.readFileSync(p,'utf8')));
  }
  const cacheKey = `${symbol}|${range}|${interval}`;
  const cached = cacheGet(historyCache, cacheKey, 6*60*60*1000);
  if (cached) return res.json({ source:'cache', symbol, range, interval, ...cached });

  try {
    const j = await fetchYahooChart(symbol, range, interval);
    if (!j || !j.chart || !j.chart.result || !j.chart.result[0]) {
      return res.status(500).json({ error:'Yahoo history returned no data', details:j });
    }
    const r = j.chart.result[0];
    const q = r.indicators && r.indicators.quote && r.indicators.quote[0] ? r.indicators.quote[0] : null;
    const timestamps = safeArr(r.timestamp);
    if (!q) return res.status(500).json({ error:'No indicator.quote' });

    const closes = safeArr(q.close).map(n=>typeof n==='number'?n:null);
    const opens = safeArr(q.open).map(n=>typeof n==='number'?n:null);
    const highs = safeArr(q.high).map(n=>typeof n==='number'?n:null);
    const lows = safeArr(q.low).map(n=>typeof n==='number'?n:null);

    // new: try to extract volumes (Yahoo places volume as q.volume)
    const volumesRaw = Array.isArray(q.volume) ? q.volume : (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].volume ? r.indicators.quote[0].volume : []);
    const volumes = safeArr(volumesRaw).map(v => typeof v === 'number' ? v : null);

    const payload = { symbol, range, interval, timestamps, opens, highs, lows, closes, volumes };
    cacheSet(historyCache, cacheKey, payload);
    return res.json({ source:'yahoo', ...payload });
  } catch (err) {
    console.error('history error', err);
    return res.status(500).json({ error:'Yahoo history error', details:String(err) });
  }
});

// ---------------- indicators helpers: EMA, SMA, RSI, MACD ----------------
function sma(arr, period) {
  if (arr.length < period) return null;
  const a = arr.slice(-period);
  return a.reduce((s,v)=>s+v,0)/a.length;
}
function ema(arr, period) {
  if (arr.length < period) return null;
  const k = 2/(period+1);
  let emaPrev = arr.slice(0,period).reduce((s,v)=>s+v,0)/period;
  for (let i=period;i<arr.length;i++) {
    emaPrev = arr[i]*k + emaPrev*(1-k);
  }
  return emaPrev;
}
function rsi(arr, period=14) {
  if (arr.length < period+1) return null;
  let gains=0, losses=0;
  for (let i=arr.length-period; i<arr.length; i++) {
    const diff = arr[i] - arr[i-1];
    if (diff>0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains/period, avgLoss = losses/period;
  if (avgLoss===0) return 100;
  const rs = avgGain/avgLoss;
  return 100 - (100/(1+rs));
}
function macd(arr, fast=12, slow=26, signal=9) {
  if (arr.length < slow + signal) return null;
  const fastEma = ema(arr, fast);
  const slowEma = ema(arr, slow);
  if (fastEma==null || slowEma==null) return null;
  // for signal line compute MACD series and then ema of that — we'll approximate by computing macd value and omit signal series history for simplicity
  const macdLine = fastEma - slowEma;
  // compute signal by computing ema of macd line over 'signal' with a constructed series — approximate by using macdLine as last point
  // Simpler: compute macd histogram using short window: not exact but informative
  return { macd: macdLine };
}

// ---------------- /api/indicators ----------------
// returns MA50, MA200, EMA20, RSI14, MACD
app.get('/api/indicators', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  const range = req.query.range || '1y';
  const interval = req.query.interval || '1d';
  const cacheKey = `${symbol}|${range}|${interval}`;
  const cached = cacheGet(historyCache, cacheKey, 6*60*60*1000);
  let closes;
  if (cached) closes = cached.closes;
  else {
    // fetch fresh
    try {
      const j = await fetchYahooChart(symbol, range, interval);
      const r = j.chart && j.chart.result && j.chart.result[0];
      if (!r) return res.status(500).json({ error:'failed to fetch history for indicators', details:j });
      closes = safeArr(r.indicators.quote[0].close).filter(v => typeof v === 'number');
    } catch (err) {
      return res.status(500).json({ error:'history fetch error', details:String(err) });
    }
  }
  if (!closes || closes.length < 50) return res.status(500).json({ error:'not enough closes', count:(closes||[]).length });

  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const ema20 = ema(closes, 20);
  const rsi14 = rsi(closes, 14);
  const macdVal = macd(closes);

  return res.json({ symbol, ma50, ma200, ema20, rsi14, macd: macdVal, len: closes.length });
});

// ---------------- /api/summary (AI-style simple summary) ----------------
app.get('/api/summary', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  // call indicators and recommendation
  try {
    const indRes = await fetch(`${req.protocol}://${req.get('host')}/api/indicators?symbol=${symbol}`);
    const ind = await indRes.json();
    const recRes = await fetch(`${req.protocol}://${req.get('host')}/api/recommend?symbol=${symbol}`);
    const rec = await recRes.json();
    const lines = [];
    if (rec && rec.rec) {
      lines.push(`${symbol} recommendation: ${rec.rec.reason} (score ${rec.rec.score}).`);
      lines.push(`Recent close: ${rec.rec.recentClose}.`);
    }
    if (ind) {
      if (typeof ind.ma50 === 'number' && typeof ind.ma200 === 'number') {
        lines.push(`MA50: ${Number(ind.ma50).toFixed(2)}, MA200: ${Number(ind.ma200).toFixed(2)}.`);
        lines.push(`EMA20: ${ind.ema20?Number(ind.ema20).toFixed(2):'n/a'}.`);
      }
      if (ind.rsi14) lines.push(`RSI(14): ${Number(ind.rsi14).toFixed(1)}.`);
      if (ind.macd && ind.macd.macd) lines.push(`MACD: ${Number(ind.macd.macd).toFixed(3)}.`);
    }
    // Simple interpretation
    const verdict = (rec && rec.rec && rec.rec.score>=60) ? 'Bullish' : (rec && rec.rec && rec.rec.score<=40)?'Bearish':'Neutral';
    lines.push(`Quick verdict: ${verdict}.`);
    return res.json({ symbol, summary: lines.join(' ') });
  } catch (err) {
    return res.status(500).json({ error:'summary error', details:String(err) });
  }
});

// ---------------- /api/search (autocomplete) ----------------
// uses Yahoo autoc endpoint
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ result: [] });
  try {
    const url = `https://autoc.finance.yahoo.com/autoc?query=${encodeURIComponent(q)}&region=1&lang=en`;
    const r = await fetch(url);
    const j = await r.json();
    const results = (j && j.ResultSet && j.ResultSet.Result) ? j.ResultSet.Result : (j && j.Result) ? j.Result : [];
    // normalize
    const out = (results || []).map(x => ({ symbol: x.symbol || x.ticker || x.id, name: x.name || x.exchDisp || x.type || '' }));
    return res.json({ result: out });
  } catch (err) {
    return res.status(500).json({ error:'search error', details:String(err) });
  }
});

// ---------------- alerts endpoints ----------------
// POST /api/alerts { symbol, type: 'gt'|'lt', price: number, webhook: optional }
app.post('/api/alerts', (req, res) => {
  const { symbol, type, price, webhook } = req.body;
  if (!symbol || !type || !price) return res.status(400).json({ error: 'missing fields' });
  const id = String(Date.now()) + Math.random().toString(36).slice(2,8);
  alerts.push({ id, symbol: symbol.toUpperCase(), type, price: Number(price), webhook: webhook || null });
  return res.json({ ok: true, id });
});
app.get('/api/alerts', (req, res) => res.json({ alerts }));
app.delete('/api/alerts/:id', (req, res) => {
  alerts = alerts.filter(a => a.id !== req.params.id);
  res.json({ ok: true });
});

// manual check alerts endpoint: it will evaluate all alerts and optionally fire webhook POSTs
app.post('/api/check-alerts', async (req, res) => {
  const triggered = [];
  for (const a of alerts.slice()) {
    try {
      const quoteR = await fetch(`${req.protocol}://${req.get('host')}/api/quote?symbol=${a.symbol}`);
      const q = await quoteR.json();
      const price = q && q.data && q.data.c;
      if (typeof price !== 'number') continue;
      let hit = false;
      if (a.type === 'gt' && price > a.price) hit = true;
      if (a.type === 'lt' && price < a.price) hit = true;
      if (hit) {
        triggered.push({ id: a.id, symbol: a.symbol, price, alert: a });
        // optionally call webhook
        if (a.webhook) {
          try {
            await fetch(a.webhook, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id: a.id, symbol: a.symbol, price }) });
          } catch(e) { console.error('webhook fire error', e); }
        }
        // remove alert after firing (one-shot)
        alerts = alerts.filter(x => x.id !== a.id);
      }
    } catch (e) { console.error('check-alerts error', e); }
  }
  res.json({ triggered });
});

// ---------------- portfolio endpoints (in-memory) ----------------
app.get('/api/portfolio', (req, res) => res.json({ portfolio }));
app.post('/api/portfolio', (req, res) => {
  const { symbol, qty } = req.body;
  if (!symbol || !qty) return res.status(400).json({ error:'missing' });
  const id = String(Date.now()) + Math.random().toString(36).slice(2,8);
  portfolio.push({ id, symbol: symbol.toUpperCase(), qty: Number(qty) });
  return res.json({ ok:true, id });
});
app.delete('/api/portfolio/:id', (req,res) => {
  portfolio = portfolio.filter(p => p.id !== req.params.id);
  res.json({ ok:true });
});

// ---------------- recommendation (reuses recommend.js) ----------------
app.get('/api/recommend', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  try {
    const cacheKey = `${symbol}|1y|1d`;
    const cached = cacheGet(historyCache, cacheKey, 6*60*60*1000);
    let closes;
    if (cached) closes = cached.closes;
    else {
      const j = await fetchYahooChart(symbol,'1y','1d');
      const r = j.chart && j.chart.result && j.chart.result[0];
      if (!r) return res.status(500).json({ error:'Failed to fetch history', details:j });
      closes = safeArr(r.indicators.quote[0].close).filter(v => typeof v === 'number');
      cacheSet(historyCache, cacheKey, { closes });
    }
    if (!closes || closes.length < 200) return res.status(500).json({ error:'Not enough history', count: (closes||[]).length });
    const rec = recommendationFromCloses(closes);
    return res.json({ symbol, rec });
  } catch (err) {
    console.error('recommend error', err);
    return res.status(500).json({ error:'recommend error', details:String(err) });
  }
});

// ---------------- start ----------------
app.listen(PORT, () => {
  console.log(`Extended Yahoo backend running on ${PORT} | MOCK=${MOCK}`);
});
