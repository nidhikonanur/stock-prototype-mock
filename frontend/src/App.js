// frontend/src/App.js
import React, { useState, useEffect, useRef } from "react";
const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const REFRESH = 60000; // 60s

// helpers
const fmt = n => (typeof n === "number" ? n.toFixed(2) : String(n));
const tsToLocal = ts => (ts ? new Date(ts * 1000).toLocaleString() : "n/a");
const shortTime = ts => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const shortDate = ts => (ts ? new Date(ts * 1000).toLocaleDateString() : "");

// moving average series
function movingAverageSeries(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return [];
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (i < period) {
      sum += (typeof v === "number" ? v : 0);
      if (i === period - 1) out[i] = sum / period;
    } else {
      if (typeof arr[i] === "number" && typeof arr[i - period] === "number") {
        sum = sum - arr[i - period] + arr[i];
        out[i] = sum / period;
      } else {
        // fallback: compute from slice
        const slice = arr.slice(Math.max(0, i - period + 1), i + 1).filter(x => typeof x === "number");
        out[i] = slice.length === period ? slice.reduce((a, b) => a + b, 0) / period : null;
      }
    }
  }
  return out;
}

// CandleChart with axes, gridlines, volumes, and MA overlays
function CandleChart({
  timestamps = [],
  opens = [],
  highs = [],
  lows = [],
  closes = [],
  volumes = [],
  width = 800,
  height = 360,
  axisPadding = 50,
  showGrid = true
}) {
  if (!timestamps || timestamps.length < 2 || !closes || closes.length < 2) {
    return <div style={{ height }}>No chart</div>;
  }

  // build points aligned to original arrays (skip nulls)
  const points = [];
  for (let i = 0; i < closes.length; i++) {
    const t = timestamps[i];
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i], v = volumes[i];
    if (t !== undefined && t !== null && [o, h, l, c].every(val => val !== undefined && val !== null)) {
      points.push({ t, o, h, l, c, v: (typeof v === "number" ? v : null) });
    } else {
      // include placeholder for spacing if there's a timestamp
      if (t !== undefined && t !== null) points.push({ t, o: null, h: null, l: null, c: null, v: (typeof v === "number" ? v : null) });
    }
  }
  if (!points.length) return <div style={{ height }}>No usable candles</div>;

  // compute ranges from available highs/lows
  const highsArr = points.map(p => p.h).filter(x => typeof x === "number");
  const lowsArr = points.map(p => p.l).filter(x => typeof x === "number");
  const volArr = points.map(p => (typeof p.v === "number" ? p.v : 0));
  const max = Math.max(...highsArr);
  const min = Math.min(...lowsArr);
  const pricePadding = (max - min) * 0.08 || 1;
  const yMax = max + pricePadding;
  const yMin = min - pricePadding;

  // drawing areas
  const left = axisPadding;
  const right = width - 10;
  const top = 10;
  const bottom = height - axisPadding;
  const volHeight = 60; // bottom area for volume bars
  const chartBottom = bottom - volHeight - 10; // leave small gap
  const chartHeight = chartBottom - top;
  const n = points.length;
  const availablePoints = points.length;
  const w = right - left;
  const step = availablePoints > 1 ? w / (availablePoints - 1) : w;
  const candleW = Math.max(3, Math.min(18, step * 0.6));

  const scaleY = v => top + (1 - (v - yMin) / (yMax - yMin)) * chartHeight;

  // Y ticks major and minor
  const yMajorTicks = 5;
  const yMajorVals = Array.from({ length: yMajorTicks }, (_, i) => yMin + (i / (yMajorTicks - 1)) * (yMax - yMin)).reverse();
  const yMinorCount = 4; // minor subdivisions between majors

  // compute MA series for overlay
  const closesNumeric = points.map(p => (typeof p.c === "number" ? p.c : null));
  const ma50 = movingAverageSeries(closesNumeric, 50);
  const ma200 = movingAverageSeries(closesNumeric, 200);

  // volume scaling
  const maxVol = Math.max(...volArr, 1);
  const volScale = v => chartBottom + 10 + (1 - (v / maxVol)) * volHeight;

  // X label step
  const maxXLabels = 8;
  const xLabelStep = Math.max(1, Math.floor(availablePoints / maxXLabels));

  return (
    <svg width={width} height={height} style={{ background: "#fff", border: "1px solid #eee" }}>
      {/* Y minor gridlines */}
      {yMajorVals.map((val, idx) => {
        // draw minor ticks between this and next if applicable
        const yMajor = scaleY(val);
        // major line
        return (
          <g key={idx}>
            <line x1={left} x2={right} y1={yMajor} y2={yMajor} stroke="#eee" strokeWidth={1} />
            <text x={left - 8} y={yMajor + 4} textAnchor="end" style={{ fontSize: 11, fill: "#333" }}>{Number(val).toFixed(2)}</text>
            {/* minor lines */}
            {Array.from({ length: yMinorCount - 1 }).map((_, mi) => {
              const nextVal = idx < yMajorVals.length - 1 ? yMajorVals[idx + 1] : yMin;
              const frac = (mi + 1) / yMinorCount;
              const minorVal = val - frac * (val - nextVal);
              const yMinor = scaleY(minorVal);
              return <line key={mi} x1={left} x2={right} y1={yMinor} y2={yMinor} stroke="#f6f6f6" strokeWidth={1} />;
            })}
          </g>
        );
      })}

      {/* candles + wicks */}
      {points.map((p, i) => {
        const x = left + i * step;
        if ([p.o, p.h, p.l, p.c].some(v => v === null || v === undefined)) {
          // skip drawing candle when data missing
          return null;
        }
        const yO = scaleY(p.o);
        const yC = scaleY(p.c);
        const yH = scaleY(p.h);
        const yL = scaleY(p.l);
        const rectY = Math.min(yO, yC);
        const rectH = Math.max(1, Math.abs(yC - yO));
        const color = p.c >= p.o ? "#2ecc71" : "#e74c3c";
        return (
          <g key={i}>
            {/* wick */}
            <line x1={x} x2={x} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            {/* body */}
            <rect x={x - candleW / 2} y={rectY} width={candleW} height={rectH} fill={color} stroke={color} />
          </g>
        );
      })}

      {/* MA50 line */}
      {ma50 && ma50.length > 0 && (
        <polyline
          points={ma50.map((v, i) => {
            if (typeof v !== "number") return null;
            const x = left + i * step;
            const y = scaleY(v);
            return `${x},${y}`;
          }).filter(Boolean).join(" ")}
          fill="none"
          stroke="#1e88e5"
          strokeWidth={2}
        />
      )}

      {/* MA200 line */}
      {ma200 && ma200.length > 0 && (
        <polyline
          points={ma200.map((v, i) => {
            if (typeof v !== "number") return null;
            const x = left + i * step;
            const y = scaleY(v);
            return `${x},${y}`;
          }).filter(Boolean).join(" ")}
          fill="none"
          stroke="#ff9800"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      )}

      {/* volume bars */}
      {points.map((p, i) => {
        const x = left + i * step;
        const vol = typeof p.v === "number" ? p.v : 0;
        const volTop = volScale(vol);
        const volBottom = chartBottom + 10 + volHeight;
        const volH = Math.max(1, volBottom - volTop);
        const color = p.c >= p.o ? "rgba(46,204,113,0.6)" : "rgba(231,76,60,0.6)";
        return (
          <rect key={`v${i}`} x={x - candleW / 2} y={volTop} width={candleW} height={volH} fill={color} />
        );
      })}

      {/* X axis labels */}
      {points.map((p, i) => {
        if (i % xLabelStep !== 0 && i !== points.length - 1) return null;
        const x = left + i * step;
        const label = shortTime(p.t);
        return <text key={i} x={x} y={chartBottom + volHeight + 30} textAnchor="middle" style={{ fontSize: 11, fill: "#333" }}>{label}</text>;
      })}

      {/* baseline lines */}
      <line x1={left} x2={right} y1={chartBottom} y2={chartBottom} stroke="#000" strokeWidth={1} />
      <line x1={left} x2={left} y1={top} y2={chartBottom} stroke="#000" strokeWidth={1} />

      {/* small legend */}
      <g>
        <rect x={left} y={top - 8} width={12} height={6} fill="#1e88e5" />
        <text x={left + 18} y={top - 2} style={{ fontSize: 12 }}>MA50</text>
        <rect x={left + 90} y={top - 8} width={12} height={6} fill="#ff9800" />
        <text x={left + 110} y={top - 2} style={{ fontSize: 12 }}>MA200</text>
      </g>
    </svg>
  );
}

const CandleControls = ({ interval, setInterval, range, setRange }) => (
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <label>
      Resolution:
      <select value={interval} onChange={e => setInterval(e.target.value)} style={{ marginLeft: 6 }}>
        <option value="1m">1m</option>
        <option value="5m">5m</option>
        <option value="15m">15m</option>
        <option value="1d">1d</option>
      </select>
    </label>
    <label>
      Range:
      <select value={range} onChange={e => setRange(e.target.value)} style={{ marginLeft: 6 }}>
        <option value="1d">1d</option>
        <option value="5d">5d</option>
        <option value="1mo">1mo</option>
        <option value="3mo">3mo</option>
        <option value="1y">1y</option>
      </select>
    </label>
  </div>
);

export default function App() {
  const [symbol, setSymbol] = useState("AAPL");
  const [mode, setMode] = useState("mock"); // mock | live
  const [quote, setQuote] = useState(null);
  const [rec, setRec] = useState(null);
  const [hist, setHist] = useState(null); // {timestamps,opens,highs,lows,closes,volumes}
  const [ind, setInd] = useState(null);
  const [summary, setSummary] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [watchlist, setWatchlist] = useState(["AAPL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "GOOG"]);
  const [portfolio, setPortfolio] = useState(() => JSON.parse(localStorage.getItem("portfolio") || "[]"));
  const [alerts, setAlerts] = useState([]);
  const [cooldown, setCooldown] = useState(0);

  // new chart controls
  const [interval, setIntervalState] = useState("5m");
  const [range, setRangeState] = useState("5d");

  // cooldown timer
  useEffect(() => {
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  // load quote + hist on symbol change or mode or interval/range
  useEffect(() => {
    let mounted = true;
    async function loadAll() {
      // quote
      if (mode === "mock") {
        setQuote({ symbol: "AAPL", data: { c: 194.35, o: 195.2, h: 196, l: 193.1, pc: 194, t: 1701360000 } });
      } else {
        try {
          const r = await fetch(`${API}/api/quote?symbol=${symbol}`);
          const j = await r.json();
          setQuote(j);
        } catch (e) { setQuote(null); }
      }

      // history for chart: use selected range & interval
      if (mode === "mock") {
        const closes = Array.from({ length: 40 }, (_, i) => 180 + i * 1.2);
        setHist({ timestamps: [], opens: [], highs: [], lows: [], closes, volumes: [] });
      } else {
        try {
          const r = await fetch(`${API}/api/history?symbol=${symbol}&range=${range}&interval=${interval}`);
          const j = await r.json();
          if (j && j.closes) setHist({ timestamps: j.timestamps, opens: j.opens, highs: j.highs, lows: j.lows, closes: j.closes, volumes: j.volumes || [] });
          else setHist(null);
        } catch (e) { setHist(null); }
      }

      // indicators & summary (only for live)
      if (mode === "live") {
        try {
          const rr = await fetch(`${API}/api/indicators?symbol=${symbol}&range=${range}&interval=${interval}`);
          const jj = await rr.json();
          setInd(jj);
        } catch (e) { setInd(null); }
        try {
          const r3 = await fetch(`${API}/api/summary?symbol=${symbol}`);
          const j3 = await r3.json();
          setSummary(j3.summary || "");
        } catch (e) { setSummary(""); }
      } else {
        setInd(null); setSummary("");
      }

      setCooldown(60);
    }
    loadAll();
    const id = setInterval(() => { if (mode === "live") loadAll(); }, REFRESH);
    return () => clearInterval(id);
  }, [symbol, mode, interval, range]);

  // search autocomplete
  async function handleSearch(q) {
    if (!q) return setSearchResults([]);
    try {
      const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      setSearchResults(j.result || []);
    } catch (e) { setSearchResults([]); }
  }

  // get recommendation
  async function getRecommendation() {
    if (mode === "mock") { setRec({ rec: { score: 100, reason: "Bullish", ma50: 237.25, ma200: 199.75, recentClose: 249.5 } }); return; }
    try {
      const r = await fetch(`${API}/api/recommend?symbol=${symbol}`);
      const j = await r.json();
      setRec(j);
    } catch (e) { setRec({ error: "Failed to fetch recommendation" }); }
  }

  // portfolio helpers
  function addToPortfolio(sym, qty) {
    const p = [...portfolio, { id: Date.now().toString(36), symbol: sym, qty: Number(qty) }];
    setPortfolio(p); localStorage.setItem("portfolio", JSON.stringify(p));
  }
  function removeFromPortfolio(id) {
    const p = portfolio.filter(x => x.id !== id); setPortfolio(p); localStorage.setItem("portfolio", JSON.stringify(p));
  }

  // alerts UI functions (unchanged)
  async function createAlert(sym, type, price, webhook) {
    try {
      const r = await fetch(`${API}/api/alerts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: sym, type, price, webhook }) });
      const j = await r.json();
      if (j && j.id) setAlerts(prev => [...prev, { id: j.id, symbol: sym, type, price, webhook }]);
    } catch (e) { console.error(e); }
  }
  async function removeAlert(id) {
    await fetch(`${API}/api/alerts/${id}`, { method: 'DELETE' });
    setAlerts(prev => prev.filter(a => a.id !== id));
  }
  async function checkAlerts() {
    const r = await fetch(`${API}/api/check-alerts`, { method: 'POST' });
    const j = await r.json();
    if (j && j.triggered && j.triggered.length) alert(`Alerts triggered: ${j.triggered.map(t => t.symbol).join(', ')}`);
  }

  // watchlist
  function addWatch(sym) { if (!watchlist.includes(sym)) setWatchlist([...watchlist, sym]); }
  function removeWatch(sym) { setWatchlist(watchlist.filter(s => s !== sym)); }

  // latest trading day display
  const lastTradeDay = hist && hist.timestamps && hist.timestamps.length ? shortDate(hist.timestamps.filter(t=>t)[hist.timestamps.filter(t=>t).length - 1]) : '';

  return (
    <div style={{ padding: 20, fontFamily: 'Inter, Arial, sans-serif', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Stock Prototype — Chart + Axes + Volume + MAs</h1>
        <div style={{ fontSize: 12 }}>Backend: <code style={{ background: '#eee', padding: '3px 6px' }}>{API || '(same origin)'}</code></div>
      </header>

      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <label><input type="radio" checked={mode === 'mock'} onChange={() => setMode('mock')} /> Mock</label>
        <label><input type="radio" checked={mode === 'live'} onChange={() => setMode('live')} /> Live</label>

        <input placeholder="Search symbol..." onChange={(e) => handleSearch(e.target.value)} style={{ marginLeft: 20 }} />
        <div>
          {searchResults.slice(0, 6).map(r => (
            <button key={r.symbol} style={{ margin: 4 }} onClick={() => setSymbol(r.symbol)}>{r.symbol} {r.name ? `(${r.name})` : ''}</button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {watchlist.map(w => (
          <button key={w} onClick={() => setSymbol(w)} style={{ padding: '6px 10px', background: w === symbol ? '#007bff' : '#eee', color: w === symbol ? '#fff' : '#000', border: 'none', borderRadius: 6 }}>{w}</button>
        ))}
        <button onClick={() => { const s = prompt('Symbol to add'); if (s) addWatch(s.toUpperCase()); }}>+ add</button>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <div><strong>Symbol:</strong> <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} /></div>
        <button onClick={getRecommendation}>Get recommendation</button>
        <button onClick={() => { setCooldown(60); }}>Manual Refresh</button>
        <div style={{ marginLeft: 10 }}>Next update: {cooldown}s</div>
        <div style={{ marginLeft: 20 }}><button onClick={checkAlerts}>Check Alerts</button></div>
      </div>

      <div style={{ marginTop: 16 }}>
        <CandleControls interval={interval} setInterval={setIntervalState} range={range} setRange={setRangeState} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginTop: 16 }}>
        <div>
          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Quote</h3>
            {quote && quote.data ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{quote.symbol}</div>
                <div>Timestamp: {tsToLocal(quote.data.t)}</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <div>Current: <strong>{fmt(quote.data.c)}</strong></div>
                  <div>Open: {fmt(quote.data.o)}</div>
                  <div>High: {fmt(quote.data.h)}</div>
                  <div>Low: {fmt(quote.data.l)}</div>
                  <div>Prev Close: {fmt(quote.data.pc)}</div>
                </div>
              </>
            ) : <div>No data</div>}
          </section>

          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Chart ({range} / {interval})</h3>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
              Last trading day: <strong>{lastTradeDay || 'n/a'}</strong> • Market close (regular): <strong>4:00 PM ET</strong>
            </div>
            {hist && hist.closes ? (
              <CandleChart timestamps={hist.timestamps} opens={hist.opens} highs={hist.highs} lows={hist.lows} closes={hist.closes} volumes={hist.volumes || []} width={740} height={360} />
            ) : <div>No history</div>}
          </section>

          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Indicators</h3>
            {ind ? (
              <div>
                <div>MA50: {ind.ma50 ? fmt(ind.ma50) : 'n/a'}</div>
                <div>MA200: {ind.ma200 ? fmt(ind.ma200) : 'n/a'}</div>
                <div>EMA20: {ind.ema20 ? fmt(ind.ema20) : 'n/a'}</div>
                <div>RSI14: {ind.rsi14 ? fmt(ind.rsi14) : 'n/a'}</div>
                <div>MACD: {ind.macd && ind.macd.macd ? Number(ind.macd.macd).toFixed(3) : 'n/a'}</div>
              </div>
            ) : <div>No indicators</div>}
          </section>

          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Summary</h3>
            <div>{summary || 'Click Get recommendation to generate summary.'}</div>
          </section>
        </div>

        <div>
          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Recommendation</h3>
            {rec && rec.rec ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{rec.rec.score}</div>
                <div>{rec.rec.reason}</div>
                <div>Recent Close: {rec.rec.recentClose}</div>
                <div>MA50: {fmt(rec.rec.ma50)} MA200: {fmt(rec.rec.ma200)}</div>
              </>
            ) : rec && rec.error ? <div style={{ color: 'red' }}>{rec.error}</div> : <div>Click Get recommendation</div>}
          </section>

          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Portfolio</h3>
            <div>
              <button onClick={() => { const s = prompt('symbol'); const q = prompt('qty'); if (s && q) addToPortfolio(s.toUpperCase(), Number(q)); }}>Add position</button>
            </div>
            <ul>
              {portfolio.map(p => (
                <li key={p.id}>
                  {p.symbol} — {p.qty}
                  <button style={{ marginLeft: 8 }} onClick={() => removeFromPortfolio(p.id)}>remove</button>
                </li>
              ))}
            </ul>
          </section>

          <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Alerts</h3>
            <div>
              <button onClick={() => { const s = prompt('symbol'); const type = prompt('type: gt or lt'); const price = prompt('price'); const webhook = prompt('optional webhook url'); if (s && type && price) createAlert(s.toUpperCase(), type, Number(price), webhook || null); }}>Create alert</button>
            </div>
            <ul>
              {alerts.map(a => (
                <li key={a.id}>
                  {a.symbol} {a.type} {a.price} <button onClick={() => removeAlert(a.id)}>x</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <footer style={{ marginTop: 20, fontSize: 12, color: '#666' }}>Demo and prototype — not financial advice.</footer>
    </div>
  );
}
