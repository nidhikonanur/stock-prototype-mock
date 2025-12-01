// frontend/src/App.js
import React, { useEffect, useRef, useState } from "react";

/**
 * Live-only frontend App.js (polished UI)
 * - Replace your existing frontend/src/App.js with this file
 * - Make sure REACT_APP_API_URL is set (or leave blank to use same origin)
 */

const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const REFRESH = 60000; // auto-refresh (ms)

// ----------------- small helpers -----------------
const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : String(n));
const tsToLocal = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : "n/a");
const shortTime = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const shortDate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString() : "");

// moving average helper
function movingAverage(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return [];
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = typeof arr[i] === "number" ? arr[i] : 0;
    sum += v;
    if (i >= period) {
      const prev = typeof arr[i - period] === "number" ? arr[i - period] : 0;
      sum -= prev;
    }
    if (i >= period - 1) {
      // compute average using available numeric values in window
      const window = arr.slice(i - period + 1, i + 1).filter((x) => typeof x === "number");
      out[i] = window.length === period ? window.reduce((a, b) => a + b, 0) / period : null;
    }
  }
  return out;
}

// Catmull-Rom to cubic Bézier conversion (returns path string)
// pts: [{x,y},...]
function catmullRom2bezier(pts) {
  if (!pts || pts.length < 2) return "";
  const tension = 0.5;
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1] || pts[i];
    const p3 = pts[i + 2] || p2;
    if (i === 0) {
      d += `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} `;
    }
    if (!p2) continue;
    const cp1x = p1.x + (p2.x - p0.x) / 6 * tension * 2;
    const cp1y = p1.y + (p2.y - p0.y) / 6 * tension * 2;
    const cp2x = p2.x - (p3.x - p1.x) / 6 * tension * 2;
    const cp2y = p2.y - (p3.y - p1.y) / 6 * tension * 2;
    d += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} `;
  }
  return d;
}

// ----------------- Visual components -----------------

/* LineAreaChart:
   - draws a smooth line (Catmull-Rom → Bezier)
   - shaded area below the line
   - previous close dotted line with label
   - hover tooltip (movable) and pin on click
   - overlays MA50 & MA200
   - volume bars below (if volumes array provided)
*/
function LineAreaChart({
  timestamps = [],
  closes = [],
  volumes = [],
  previousClose = null,
  width = 740,
  height = 340,
  leftPad = 64,
  bottomPad = 56
}) {
  // basic guard
  if (!Array.isArray(closes) || closes.filter((v) => typeof v === "number").length < 2) {
    return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>No chart data</div>;
  }

  // Align points where timestamp AND numeric close exist
  const pts = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const t = timestamps && timestamps[i] ? timestamps[i] : null;
    if (typeof c === "number" && t) pts.push({ t, c, idx: i });
  }
  if (pts.length < 2) return <div style={{ height }}>No usable points</div>;

  // compute ranges
  const vals = pts.map((p) => p.c);
  const maxVal = Math.max(...vals);
  const minVal = Math.min(...vals);
  const pad = (maxVal - minVal) * 0.08 || 1;
  const yMax = maxVal + pad;
  const yMin = minVal - pad;

  // layout
  const left = leftPad;
  const right = width - 10;
  const top = 12;
  const bottom = height - bottomPad;
  const chartH = bottom - top;
  const w = right - left;
  const n = pts.length;
  const step = n > 1 ? w / (n - 1) : w;

  const xForIndex = (i) => left + i * step;
  const yForVal = (v) => top + (1 - (v - yMin) / (yMax - yMin)) * chartH;

  // build smooth path points (Bezier)
  const pathPts = pts.map((p, idx) => ({ x: xForIndex(idx), y: yForVal(p.c) }));
  const pathD = catmullRom2bezier(pathPts);

  // area polygon string (path with line to baseline)
  const areaD = `${pathD} L ${xForIndex(n - 1)} ${bottom} L ${left} ${bottom} Z`;

  // MA overlays (from closes aligned to pts length)
  const closeSeriesAligned = pts.map((p) => p.c);
  const ma50 = movingAverage(closeSeriesAligned, 50);
  const ma200 = movingAverage(closeSeriesAligned, 200);

  // volumes scaling
  const volMax = Math.max(...(volumes && volumes.length ? volumes.filter(v=>typeof v==='number') : [0]), 1);
  const volAreaTop = bottom + 8;
  const volAreaBottom = height - 8;
  const volAreaHeight = volAreaBottom - volAreaTop;

  // Y ticks (nice rounded)
  const yTicks = 4;
  const yVals = Array.from({ length: yTicks }, (_, i) => yMin + (i / (yTicks - 1)) * (yMax - yMin)).reverse();

  // X labels spacing
  const maxXLabels = 6;
  const xLabelStep = Math.max(1, Math.floor(n / maxXLabels));

  // tooltip & pin
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null); // {x,y,idx,time,price}
  const [pinned, setPinned] = useState(null);

  function onMove(e) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(n - 1, Math.round((mx - left) / step)));
    const p = pts[idx];
    if (!p) {
      setTooltip(null);
      return;
    }
    setTooltip({
      x: xForIndex(idx),
      y: yForVal(p.c),
      idx,
      time: p.t,
      price: p.c
    });
  }
  function onLeave() {
    if (!pinned) setTooltip(null);
  }
  function onClick() {
    if (tooltip) {
      if (pinned && pinned.idx === tooltip.idx) setPinned(null);
      else setPinned({ ...tooltip });
    }
  }

  const activeTip = pinned || tooltip;
  const lastPoint = pts[pts.length - 1];

  // styles
  const containerStyle = { position: "relative", width, height, fontFamily: "Inter, Roboto, Arial, sans-serif" };

  return (
    <div style={containerStyle}>
      <svg ref={svgRef} width={width} height={height} onMouseMove={onMove} onMouseLeave={onLeave} onClick={onClick} style={{ background: "#fff", borderRadius: 8 }}>
        {/* Y grid lines and labels */}
        {yVals.map((val, i) => {
          const y = yForVal(val);
          return (
            <g key={i}>
              <line x1={left} x2={right} y1={y} y2={y} stroke="#f0f2f5" strokeWidth={1} />
              <text x={left - 10} y={y + 4} fontSize="11" fill="#6b7280" textAnchor="end">{val.toFixed(2)}</text>
            </g>
          );
        })}

        {/* Previous close dotted line */}
        {typeof previousClose === "number" && previousClose >= yMin && previousClose <= yMax && (() => {
          const py = yForVal(previousClose);
          return (
            <g key="prev">
              <line x1={left} x2={right} y1={py} y2={py} stroke="#9ca3af" strokeDasharray="4 6" strokeWidth={1} />
              <rect x={right - 120} y={py - 18} rx={6} ry={6} width={110} height={26} fill="#fff" stroke="#e6e6e6" />
              <text x={right - 64} y={py - 2} fontSize="12" fill="#374151" textAnchor="middle">Previous close {previousClose.toFixed(2)}</text>
            </g>
          );
        })()}

        {/* shaded area under smooth line */}
        <path d={areaD} fill="rgba(14,116,232,0.10)" stroke="none" />

        {/* smooth line */}
        <path d={pathD} fill="none" stroke="#0b79ff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* MA50 (blue thin) */}
        {ma50 && ma50.some(v => v !== null) && (
          <path
            d={catmullRom2bezier(ma50.map((v, i) => ({ x: xForIndex(i), y: v == null ? null : yForVal(v) })).filter(p => p.y !== null))}
            fill="none"
            stroke="#1e88e5"
            strokeWidth={1.5}
            strokeOpacity={0.9}
          />
        )}

        {/* MA200 (orange dashed) */}
        {ma200 && ma200.some(v => v !== null) && (
          <path
            d={catmullRom2bezier(ma200.map((v, i) => ({ x: xForIndex(i), y: v == null ? null : yForVal(v) })).filter(p => p.y !== null))}
            fill="none"
            stroke="#ff9800"
            strokeWidth={1.4}
            strokeDasharray="6 4"
            strokeOpacity={0.9}
          />
        )}

        {/* volume bars (small, under chart) */}
        {volumes && volumes.length > 0 && volumes.map((vol, i) => {
          const x = xForIndex(i);
          const v = typeof vol === "number" ? vol : 0;
          const hVol = (v / volMax) * volAreaHeight;
          const yTop = volAreaTop + (volAreaHeight - hVol);
          const barWidth = Math.max(2, Math.min(10, step * 0.5));
          const color = closes[i] >= (closes[i - 1] || closes[i]) ? "rgba(46,204,113,0.45)" : "rgba(231,76,60,0.45)";
          return <rect key={`vol${i}`} x={x - barWidth / 2} y={yTop} width={barWidth} height={Math.max(1, hVol)} fill={color} />;
        })}

        {/* X-axis labels */}
        {pts.map((p, idx) => {
          if (idx % xLabelStep !== 0 && idx !== pts.length - 1) return null;
          const x = xForIndex(idx);
          const lbl = shortTime(p.t);
          return <text key={idx} x={x} y={bottom + 20} fontSize="11" fill="#6b7280" textAnchor="middle">{lbl}</text>;
        })}

        {/* last-price marker */}
        <circle cx={xForIndex(n - 1)} cy={yForVal(pts[n - 1].c)} r={5} fill="#0b79ff" stroke="#fff" strokeWidth={1.5} />

        {/* hover/pinned tooltip visuals */}
        {activeTip && (
          <g>
            <line x1={activeTip.x} x2={activeTip.x} y1={top} y2={bottom} stroke="#cbd5e1" strokeDasharray="3 4" />
            <rect x={Math.min(activeTip.x + 8, width - 180)} y={activeTip.y - 38} rx={8} ry={8} width={170} height={46} fill="#fff" stroke="#e6e6e6" />
            <text x={Math.min(activeTip.x + 20, width - 160)} y={activeTip.y - 18} fontSize="12" fill="#111">{new Date(activeTip.time * 1000).toLocaleString()}</text>
            <text x={Math.min(activeTip.x + 20, width - 160)} y={activeTip.y} fontSize="16" fontWeight={700} fill="#111">{activeTip.price.toFixed(2)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ----------------- Main App -----------------
export default function App() {
  // core state
  const [symbol, setSymbol] = useState("AAPL");
  const [quote, setQuote] = useState(null);
  const [hist, setHist] = useState(null); // {timestamps,opens,highs,lows,closes,volumes}
  const [ind, setInd] = useState(null);
  const [rec, setRec] = useState(null);
  const [summary, setSummary] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [watchlist, setWatchlist] = useState(["AAPL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "GOOG"]);
  const [portfolio, setPortfolio] = useState(() => JSON.parse(localStorage.getItem("portfolio") || "[]"));
  const [alerts, setAlerts] = useState([]);
  const [cooldown, setCooldown] = useState(0);

  // chart controls
  const [interval, setIntervalState] = useState("5m");
  const [range, setRangeState] = useState("5d");

  // cooldown timer
  useEffect(() => {
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  // load live data (quote, history, indicators, rec, summary)
  useEffect(() => {
    let mounted = true;

    async function loadAll() {
      try {
        // Quote
        const qRes = await fetch(`${API}/api/quote?symbol=${encodeURIComponent(symbol)}`);
        const qJson = await qRes.json();
        if (mounted) setQuote(qJson);

        // History
        const hRes = await fetch(`${API}/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
        const hJson = await hRes.json();
        if (mounted && hJson && hJson.closes) setHist({ timestamps: hJson.timestamps, opens: hJson.opens, highs: hJson.highs, lows: hJson.lows, closes: hJson.closes, volumes: hJson.volumes || [] });
        else if (mounted) setHist(null);

        // Indicators
        const iRes = await fetch(`${API}/api/indicators?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
        const iJson = await iRes.json();
        if (mounted) setInd(iJson);

        // Recommendation + summary
        const rRes = await fetch(`${API}/api/recommend?symbol=${encodeURIComponent(symbol)}`);
        const rJson = await rRes.json();
        if (mounted) setRec(rJson);

        const sRes = await fetch(`${API}/api/summary?symbol=${encodeURIComponent(symbol)}`);
        const sJson = await sRes.json();
        if (mounted) setSummary(sJson.summary || "");

        if (mounted) setCooldown(60);
      } catch (e) {
        console.error("loadAll error", e);
      }
    }

    loadAll();
    const id = setInterval(loadAll, REFRESH);
    return () => { mounted = false; clearInterval(id); };
  }, [symbol, interval, range]);

  // search
  async function handleSearch(q) {
    if (!q || q.length < 1) return setSearchResults([]);
    try {
      const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      setSearchResults(j.result || []);
    } catch (e) {
      setSearchResults([]);
    }
  }

  // manual recommendation trigger
  async function getRecommendation() {
    try {
      const r = await fetch(`${API}/api/recommend?symbol=${encodeURIComponent(symbol)}`);
      const j = await r.json();
      setRec(j);
    } catch (e) {
      setRec({ error: "Failed to fetch recommendation" });
    }
  }

  // portfolio helpers
  function addToPortfolio(sym, qty) {
    const p = [...portfolio, { id: Date.now().toString(36), symbol: sym, qty: Number(qty) }];
    setPortfolio(p);
    localStorage.setItem("portfolio", JSON.stringify(p));
  }
  function removeFromPortfolio(id) {
    const p = portfolio.filter(x => x.id !== id);
    setPortfolio(p);
    localStorage.setItem("portfolio", JSON.stringify(p));
  }

  // alerts helpers
  async function createAlert(sym, type, price, webhook) {
    try {
      const r = await fetch(`${API}/api/alerts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: sym, type, price, webhook }) });
      const j = await r.json();
      if (j && j.id) setAlerts(prev => [...prev, { id: j.id, symbol: sym, type, price, webhook }]);
    } catch (e) { console.error(e); }
  }
  async function removeAlert(id) {
    await fetch(`${API}/api/alerts/${id}`, { method: "DELETE" });
    setAlerts(prev => prev.filter(a => a.id !== id));
  }
  async function checkAlerts() {
    const r = await fetch(`${API}/api/check-alerts`, { method: "POST" });
    const j = await r.json();
    if (j && j.triggered && j.triggered.length) alert(`Alerts triggered: ${j.triggered.map(t => t.symbol).join(", ")}`);
  }

  // watchlist
  function addWatch(sym) { if (!watchlist.includes(sym)) setWatchlist([...watchlist, sym]); }
  function removeWatch(sym) { setWatchlist(watchlist.filter(s => s !== sym)); }

  // derived values
  const lastTradeDay = hist && hist.timestamps && hist.timestamps.length ? shortDate(hist.timestamps.filter(t => t)[hist.timestamps.filter(t => t).length - 1]) : "";
  const topLeftBox = quote && quote.data ? {
    price: quote.data.c,
    changePct: (quote.data.c - (quote.data.pc || quote.data.c)) / (quote.data.pc || quote.data.c) * 100,
    up: quote.data.c >= (quote.data.pc || quote.data.c)
  } : null;

  // small polished styles (inline for single-file convenience)
  const pageStyle = { fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial", color: "#111", padding: 20, maxWidth: 1100, margin: "0 auto" };
  const card = { background: "#fff", borderRadius: 12, boxShadow: "0 6px 18px rgba(15,23,42,0.06)", padding: 14, border: "1px solid rgba(15,23,42,0.04)" };
  const smallMuted = { fontSize: 12, color: "#6b7280" };

  return (
    <div style={pageStyle}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Stock Prototype</div>
          <div style={{ ...smallMuted }}>Live market chart • Demo — not financial advice</div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ ...smallMuted }}>Backend: <code style={{ background: "#f3f4f6", padding: "4px 8px", borderRadius: 6 }}>{API || "(same origin)"}</code></div>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={range} onChange={(e) => setRangeState(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #e6e6e6" }}>
              <option value="1d">1d</option>
              <option value="5d">5d</option>
              <option value="1mo">1mo</option>
              <option value="3mo">3mo</option>
              <option value="1y">1y</option>
            </select>
            <select value={interval} onChange={(e) => setIntervalState(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #e6e6e6" }}>
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1d">1d</option>
            </select>
          </div>
        </div>
      </header>

      {/* Controls Row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <div style={{ flex: 1, ...card, display: "flex", gap: 12, alignItems: "center" }}>
          <input placeholder="Search symbol (AAPL, MSFT...)" onChange={(e) => handleSearch(e.target.value)} style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #e6e6e6", fontSize: 14 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setCooldown(60); /* manual refresh */ }} style={{ padding: "8px 12px", borderRadius: 8, background: "#0b79ff", color: "#fff", border: "none" }}>Refresh</button>
            <button onClick={() => getRecommendation()} style={{ padding: "8px 12px", borderRadius: 8, background: "#f3f4f6", border: "1px solid #e6e6e6" }}>Recommend</button>
          </div>
        </div>

        {/* Watchlist pill group */}
        <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {watchlist.map((w) => (
            <button key={w} onClick={() => setSymbol(w)} style={{ padding: "6px 10px", borderRadius: 8, background: w === symbol ? "#0b79ff" : "#f3f4f6", color: w === symbol ? "#fff" : "#111", border: "none" }}>{w}</button>
          ))}
          <button onClick={() => { const s = prompt("Symbol to add"); if (s) addWatch(s.toUpperCase()); }} style={{ padding: "6px 10px", borderRadius: 8, background: "#fff", border: "1px dashed #e6e6e6" }}>+ add</button>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Quote card */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{symbol}</div>
                <div style={smallMuted}>Last trade day: <strong>{lastTradeDay || "n/a"}</strong></div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{quote && quote.data ? fmt(quote.data.c) : "—"}</div>
                <div style={{ color: quote && quote.data && quote.data.c >= (quote.data.pc || 0) ? "#16a34a" : "#ef4444", fontSize: 13 }}>
                  {quote && quote.data ? `${((quote.data.c - (quote.data.pc || quote.data.c)) / (quote.data.pc || quote.data.c) * 100).toFixed(2)}%` : ""}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 20, marginTop: 12, color: "#374151" }}>
              <div>Open: <strong>{quote && quote.data ? fmt(quote.data.o) : "—"}</strong></div>
              <div>High: <strong>{quote && quote.data ? fmt(quote.data.h) : "—"}</strong></div>
              <div>Low: <strong>{quote && quote.data ? fmt(quote.data.l) : "—"}</strong></div>
              <div>Prev: <strong>{quote && quote.data ? fmt(quote.data.pc) : "—"}</strong></div>
            </div>
          </div>

          {/* Chart card */}
          <div style={{ ...card, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>Price chart</div>
              <div style={{ ...smallMuted, fontSize: 13 }}>Market close: 4:00 PM ET</div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <LineAreaChart
                timestamps={hist ? hist.timestamps : []}
                closes={hist ? hist.closes : []}
                volumes={hist ? hist.volumes : []}
                previousClose={quote && quote.data ? quote.data.pc : null}
                width={740}
                height={360}
              />
            </div>
          </div>

          {/* Indicators & summary */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>Indicators</div>
              <div style={smallMuted}>auto</div>
            </div>
            <div style={{ display: "flex", gap: 24, color: "#374151" }}>
              <div>MA50: <strong>{ind && ind.ma50 ? fmt(ind.ma50) : "—"}</strong></div>
              <div>MA200: <strong>{ind && ind.ma200 ? fmt(ind.ma200) : "—"}</strong></div>
              <div>RSI14: <strong>{ind && ind.rsi14 ? fmt(ind.rsi14) : "—"}</strong></div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Summary</div>
              <div style={{ color: "#374151" }}>{summary || "Summary will appear after data loads."}</div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700 }}>Recommendation</div>
              <div style={smallMuted}>Model</div>
            </div>
            <div style={{ marginTop: 12 }}>
              {rec && rec.rec ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800 }}>{rec.rec.score}</div>
                  <div style={{ color: "#374151", marginTop: 6 }}>{rec.rec.reason}</div>
                  <div style={{ marginTop: 8, color: "#374151" }}>Recent Close: <strong>{fmt(rec.rec.recentClose)}</strong></div>
                  <div style={{ marginTop: 6 }}>MA50: <strong>{fmt(rec.rec.ma50)}</strong> • MA200: <strong>{fmt(rec.rec.ma200)}</strong></div>
                </>
              ) : rec && rec.error ? (
                <div style={{ color: "#ef4444" }}>{rec.error}</div>
              ) : (
                <div style={{ color: "#6b7280" }}>Click Recommend</div>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={() => getRecommendation()} style={{ padding: "8px 12px", borderRadius: 8, background: "#0b79ff", color: "#fff", border: "none" }}>Get recommendation</button>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700 }}>Portfolio</div>
              <div style={smallMuted}>Local</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <button onClick={() => { const s = prompt("Symbol"); const q = prompt("Qty"); if (s && q) addToPortfolio(s.toUpperCase(), Number(q)); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e6e6e6" }}>Add</button>
              <ul style={{ marginTop: 8 }}>
                {portfolio.map((p) => (
                  <li key={p.id} style={{ marginBottom: 6 }}>
                    {p.symbol} — {p.qty} <button onClick={() => removeFromPortfolio(p.id)} style={{ marginLeft: 8 }}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700 }}>Alerts</div>
              <div style={smallMuted}>Server</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <button onClick={() => { const s = prompt("Symbol"); const t = prompt("Type: gt/lt"); const p = prompt("Price"); if (s && t && p) createAlert(s.toUpperCase(), t, Number(p)); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e6e6e6" }}>Create</button>
              <ul style={{ marginTop: 8 }}>
                {alerts.map(a => <li key={a.id}>{a.symbol} {a.type} {a.price} <button onClick={() => removeAlert(a.id)}>✕</button></li>)}
              </ul>
            </div>
          </div>

          <div style={{ ...card, textAlign: "center", color: "#6b7280" }}>
            Next update: <strong>{cooldown}s</strong>
          </div>
        </div>
      </div>

      <footer style={{ marginTop: 20, textAlign: "center", color: "#9ca3af" }}>
        Demo prototype — not financial advice.
      </footer>
    </div>
  );
}
