// frontend/src/App.js
import React, { useState, useEffect, useRef } from "react";

/**
 * App configuration
 * Set REACT_APP_API_URL in your environment OR leave empty to use same origin
 */
const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const REFRESH = 60000; // automatic refresh interval when live (ms)

// ---------- small helpers ----------
const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : String(n));
const tsToLocal = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : "n/a");
const shortTime = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const shortDate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString() : "");

// ---------- LineAreaChart component (Google-like) ----------
function LineAreaChart({
  timestamps = [],
  closes = [],
  width = 740,
  height = 340,
  paddingLeft = 60,
  paddingBottom = 50,
  previousClose = null,
  topLeftBox = null
}) {
  // guard
  if (!Array.isArray(closes) || closes.filter(x => typeof x === "number").length < 2) {
    return <div style={{ height }}>No chart data</div>;
  }

  // build filtered points (only indices with numeric close AND timestamp)
  const pts = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const t = timestamps && timestamps[i] ? timestamps[i] : null;
    if (typeof c === "number" && t) pts.push({ t, c, i });
  }
  if (pts.length < 2) return <div style={{ height }}>No usable chart points</div>;

  // compute min/max with small padding
  const vals = pts.map((p) => p.c);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pad = (max - min) * 0.08 || 1;
  const yMax = max + pad;
  const yMin = min - pad;

  // drawing area
  const left = paddingLeft;
  const right = width - 10;
  const top = 10;
  const bottom = height - paddingBottom;
  const w = right - left;
  const h = bottom - top;
  const n = pts.length;
  const step = n > 1 ? w / (n - 1) : w;

  const xFor = (idx) => left + idx * step;
  const yFor = (v) => top + (1 - (v - yMin) / (yMax - yMin)) * h;

  // build path points
  const pathPoints = pts.map((p, idx) => `${xFor(idx)},${yFor(p.c)}`).join(" ");
  const areaPoints = [
    `${left},${bottom}`,
    ...pts.map((p, idx) => `${xFor(idx)},${yFor(p.c)}`),
    `${left + (n - 1) * step},${bottom}`
  ].join(" ");

  // Y ticks and X label spacing
  const yTicks = 5;
  const yTickVals = Array.from({ length: yTicks }, (_, i) => yMin + (i / (yTicks - 1)) * (yMax - yMin)).reverse();
  const maxLabels = 6;
  const xLabelStep = Math.max(1, Math.floor(n / maxLabels));

  // last point marker
  const last = pts[pts.length - 1];
  const lastX = xFor(pts.length - 1);
  const lastY = yFor(last.c);

  // tooltip state
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  function onMouseMove(e) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idxF = Math.round((mx - left) / step);
    const idx = Math.max(0, Math.min(n - 1, idxF));
    const p = pts[idx];
    if (!p) {
      setTooltip(null);
      return;
    }
    setTooltip({
      x: xFor(idx),
      y: yFor(p.c),
      time: p.t,
      price: p.c
    });
  }
  function onMouseLeave() {
    setTooltip(null);
  }

  const renderTopLeftBox = () => {
    if (!topLeftBox) return null;
    const { price, changePct, up } = topLeftBox;
    return (
      <div style={{
        position: "absolute",
        left: 12,
        top: 12,
        background: "white",
        padding: "8px 10px",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        fontSize: 14
      }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{price.toFixed(2)} <span style={{ fontSize: 12 }}>USD</span></div>
        <div style={{ color: up ? "#2ecc71" : "#e74c3c" }}>{(up ? "+" : "")}{changePct.toFixed(2)}%</div>
      </div>
    );
  };

  return (
    <div style={{ position: "relative", width, height }}>
      {renderTopLeftBox()}
      <svg ref={svgRef} width={width} height={height} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} style={{ background: "#fff" }}>
        {/* Y grid & labels */}
        {yTickVals.map((val, i) => {
          const y = yFor(val);
          return (
            <g key={i}>
              <line x1={left} x2={right} y1={y} y2={y} stroke="#eee" strokeWidth={1} />
              <text x={right + 6} y={y + 4} fontSize="11" fill="#444">{val.toFixed(2)}</text>
            </g>
          );
        })}

        {/* previous close dotted */}
        {typeof previousClose === "number" && (previousClose >= yMin && previousClose <= yMax) && (() => {
          const py = yFor(previousClose);
          return (
            <g key="prev-close">
              <line x1={left} x2={right} y1={py} y2={py} stroke="#999" strokeDasharray="4 6" strokeWidth={1} />
              <text x={right - 4} y={py - 6} fontSize="12" fill="#666" textAnchor="end">Prev close {previousClose.toFixed(2)}</text>
            </g>
          );
        })()}

        {/* shaded area */}
        <polygon points={areaPoints} fill="rgba(30,136,229,0.12)" stroke="none" />

        {/* line path */}
        <polyline points={pathPoints} fill="none" stroke="#1e88e5" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* last marker */}
        <circle cx={lastX} cy={lastY} r={5} fill="#1e88e5" stroke="#fff" strokeWidth={1.5} />

        {/* X baseline */}
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#ddd" />

        {/* X labels */}
        {pts.map((p, idx) => {
          if (idx % xLabelStep !== 0 && idx !== pts.length - 1) return null;
          const x = xFor(idx);
          const label = new Date(p.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return <text key={idx} x={x} y={bottom + 18} fontSize="11" textAnchor="middle" fill="#444">{label}</text>;
        })}

        {/* tooltip */}
        {tooltip && (
          <g>
            <line x1={tooltip.x} x2={tooltip.x} y1={top} y2={bottom} stroke="#bbb" strokeDasharray="3 4" />
            <rect x={tooltip.x + 8} y={tooltip.y - 28} width={140} height={48} rx={6} ry={6} fill="#fff" stroke="#ddd" />
            <text x={tooltip.x + 16} y={tooltip.y - 8} fontSize="12" fill="#111">{new Date(tooltip.time * 1000).toLocaleString()}</text>
            <text x={tooltip.x + 16} y={tooltip.y + 14} fontSize="14" fontWeight="700" fill="#000">{tooltip.price.toFixed(2)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------- App (Live-only: mock removed) ----------
export default function App() {
  // core UI state
  const [symbol, setSymbol] = useState("AAPL");
  const [quote, setQuote] = useState(null);
  const [hist, setHist] = useState(null); // {timestamps, closes, opens, highs, lows, volumes}
  const [ind, setInd] = useState(null);
  const [rec, setRec] = useState(null);
  const [summary, setSummary] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [watchlist, setWatchlist] = useState(["AAPL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "GOOG"]);
  const [portfolio, setPortfolio] = useState(() => JSON.parse(localStorage.getItem("portfolio") || "[]"));
  const [alerts, setAlerts] = useState([]);
  const [cooldown, setCooldown] = useState(0);

  // chart controls
  const [interval, setIntervalState] = useState("5m"); // default 5m intraday
  const [range, setRangeState] = useState("5d");

  // cooldown timer
  useEffect(() => {
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  // load quote, history, indicators, summary on change
  useEffect(() => {
    let mounted = true;

    async function loadAll() {
      try {
        // quote
        const rq = await fetch(`${API}/api/quote?symbol=${encodeURIComponent(symbol)}`);
        const jq = await rq.json();
        if (mounted) setQuote(jq);

        // history
        const rh = await fetch(`${API}/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
        const jh = await rh.json();
        if (mounted && jh && jh.closes) setHist({ timestamps: jh.timestamps, closes: jh.closes, opens: jh.opens, highs: jh.highs, lows: jh.lows, volumes: jh.volumes || [] });
        else if (mounted) setHist(null);

        // indicators
        const ri = await fetch(`${API}/api/indicators?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
        const ji = await ri.json();
        if (mounted) setInd(ji);

        // recommendation & summary
        const rr = await fetch(`${API}/api/recommend?symbol=${encodeURIComponent(symbol)}`);
        const jr = await rr.json();
        if (mounted) setRec(jr);

        const rs = await fetch(`${API}/api/summary?symbol=${encodeURIComponent(symbol)}`);
        const js = await rs.json();
        if (mounted) setSummary(js.summary || "");

        if (mounted) setCooldown(60);
      } catch (e) {
        console.error("loadAll error", e);
      }
    }

    loadAll();
    const id = setInterval(loadAll, REFRESH);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [symbol, interval, range]);

  // search autocomplete
  async function handleSearch(q) {
    if (!q || q.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    try {
      const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      setSearchResults(j.result || []);
    } catch (e) {
      setSearchResults([]);
    }
  }

  // recommendation (manual trigger already handled in loadAll, but keep manual)
  async function getRecommendation() {
    try {
      const r = await fetch(`${API}/api/recommend?symbol=${encodeURIComponent(symbol)}`);
      const j = await r.json();
      setRec(j);
    } catch (e) {
      setRec({ error: "Failed to fetch recommendation" });
    }
  }

  // portfolio
  function addToPortfolio(sym, qty) {
    const p = [...portfolio, { id: Date.now().toString(36), symbol: sym, qty: Number(qty) }];
    setPortfolio(p);
    localStorage.setItem("portfolio", JSON.stringify(p));
  }
  function removeFromPortfolio(id) {
    const p = portfolio.filter((x) => x.id !== id);
    setPortfolio(p);
    localStorage.setItem("portfolio", JSON.stringify(p));
  }

  // alerts
  async function createAlert(sym, type, price, webhook) {
    try {
      const r = await fetch(`${API}/api/alerts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: sym, type, price, webhook }) });
      const j = await r.json();
      if (j && j.id) setAlerts((prev) => [...prev, { id: j.id, symbol: sym, type, price, webhook }]);
    } catch (e) { console.error(e); }
  }
  async function removeAlert(id) {
    await fetch(`${API}/api/alerts/${id}`, { method: "DELETE" });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }
  async function checkAlerts() {
    const r = await fetch(`${API}/api/check-alerts`, { method: "POST" });
    const j = await r.json();
    if (j && j.triggered && j.triggered.length) alert(`Alerts triggered: ${j.triggered.map((t) => t.symbol).join(", ")}`);
  }

  // watchlist helpers
  function addWatch(sym) {
    if (!watchlist.includes(sym)) setWatchlist([...watchlist, sym]);
  }
  function removeWatch(sym) {
    setWatchlist(watchlist.filter((s) => s !== sym));
  }

  // last trading day label (from hist timestamps)
  const lastTradeDay = hist && hist.timestamps && hist.timestamps.length ? shortDate(hist.timestamps.filter(t => t)[hist.timestamps.filter(t => t).length - 1]) : "";

  // topLeftBox for chart
  const topLeftBox = quote && quote.data ? {
    price: quote.data.c,
    changePct: (quote.data.c - (quote.data.pc || quote.data.c)) / (quote.data.pc || quote.data.c) * 100,
    up: quote.data.c >= (quote.data.pc || quote.data.c)
  } : null;

  return (
    <div style={{ padding: 20, fontFamily: "Inter, Arial, sans-serif", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Stock Prototype</h1>
        <div style={{ fontSize: 12 }}>Backend: <code style={{ background: "#eee", padding: "3px 6px" }}>{API || "(same origin)"}</code></div>
      </header>

      {/* search + controls */}
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <input placeholder="Search symbol..." onChange={(e) => handleSearch(e.target.value)} style={{ marginLeft: 6 }} />
        <div>
          {searchResults.slice(0, 6).map((r) => (
            <button key={r.symbol} style={{ margin: 4 }} onClick={() => setSymbol(r.symbol)}>{r.symbol} {r.name ? `(${r.name})` : ""}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <div>
            <label>Range:
              <select value={range} onChange={(e) => setRangeState(e.target.value)} style={{ marginLeft: 6 }}>
                <option value="1d">1d</option>
                <option value="5d">5d</option>
                <option value="1mo">1mo</option>
                <option value="3mo">3mo</option>
                <option value="1y">1y</option>
              </select>
            </label>
          </div>
          <div>
            <label>Resolution:
              <select value={interval} onChange={(e) => setIntervalState(e.target.value)} style={{ marginLeft: 6 }}>
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1d">1d</option>
              </select>
            </label>
          </div>
          <button onClick={() => { setCooldown(60); /* manual refresh will trigger useEffect reload */ }}>Manual Refresh</button>
          <div style={{ alignSelf: "center" }}>Next update: {cooldown}s</div>
        </div>
      </div>

      {/* watchlist */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {watchlist.map((w) => (
          <button key={w} onClick={() => setSymbol(w)} style={{ padding: "6px 10px", background: w === symbol ? "#007bff" : "#eee", color: w === symbol ? "#fff" : "#000", border: "none", borderRadius: 6 }}>{w}</button>
        ))}
        <button onClick={() => { const s = prompt("Symbol to add"); if (s) addWatch(s.toUpperCase()); }}>+ add</button>
      </div>

      {/* main */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
        {/* left column */}
        <div>
          {/* quote card */}
          <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Quote</h3>
            {quote && quote.data ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{quote.symbol}</div>
                <div>Timestamp: {tsToLocal(quote.data.t)}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <div>Current: <strong>{fmt(quote.data.c)}</strong></div>
                  <div>Open: {fmt(quote.data.o)}</div>
                  <div>High: {fmt(quote.data.h)}</div>
                  <div>Low: {fmt(quote.data.l)}</div>
                  <div>Prev Close: {fmt(quote.data.pc)}</div>
                </div>
              </>
            ) : <div>No quote</div>}
          </section>

          {/* chart */}
          <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Price Chart ({range} / {interval})</h3>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
              Last trading day: <strong>{lastTradeDay || "n/a"}</strong> • Market close (regular): <strong>4:00 PM ET</strong>
            </div>
            <div style={{ overflowX: "auto" }}>
              <LineAreaChart
                timestamps={hist ? hist.timestamps : []}
                closes={hist ? hist.closes : []}
                width={740}
                height={340}
                previousClose={quote && quote.data ? quote.data.pc : null}
                topLeftBox={topLeftBox}
              />
            </div>
          </section>

          {/* indicators + summary */}
          <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Indicators & Summary</h3>
            {ind ? (
              <div>
                <div>MA50: {ind.ma50 ? fmt(ind.ma50) : "n/a"}</div>
                <div>MA200: {ind.ma200 ? fmt(ind.ma200) : "n/a"}</div>
                <div>EMA20: {ind.ema20 ? fmt(ind.ema20) : "n/a"}</div>
                <div>RSI14: {ind.rsi14 ? fmt(ind.rsi14) : "n/a"}</div>
                <div>MACD: {ind.macd && ind.macd.macd ? Number(ind.macd.macd).toFixed(3) : "n/a"}</div>
              </div>
            ) : <div>Loading indicators...</div>}
            <div style={{ marginTop: 8 }}>{summary || "Summary will appear here."}</div>
          </section>
        </div>

        {/* right column */}
        <div>
          <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Recommendation</h3>
            {rec && rec.rec ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{rec.rec.score}</div>
                <div>{rec.rec.reason}</div>
                <div>Recent Close: {rec.rec.recentClose}</div>
                <div>MA50: {fmt(rec.rec.ma50)} MA200: {fmt(rec.rec.ma200)}</div>
              </>
            ) : rec && rec.error ? <div style={{ color: "red" }}>{rec.error}</div> : <div>Click Get recommendation</div>}
            <div style={{ marginTop: 8 }}>
              <button onClick={getRecommendation}>Get recommendation</button>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Portfolio</h3>
            <div><button onClick={() => { const s = prompt("symbol"); const q = prompt("qty"); if (s && q) addToPortfolio(s.toUpperCase(), Number(q)); }}>Add position</button></div>
            <ul>
              {portfolio.map((p) => (
                <li key={p.id}>
                  {p.symbol} — {p.qty}
                  <button style={{ marginLeft: 8 }} onClick={() => removeFromPortfolio(p.id)}>remove</button>
                </li>
              ))}
            </ul>
          </section>

          <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Alerts</h3>
            <div>
              <button onClick={() => {
                const s = prompt("symbol");
                const type = prompt("type: gt or lt");
                const price = prompt("price");
                const webhook = prompt("optional webhook url");
                if (s && type && price) createAlert(s.toUpperCase(), type, Number(price), webhook || null);
              }}>Create alert</button>
              <button style={{ marginLeft: 8 }} onClick={() => checkAlerts()}>Check Alerts</button>
            </div>
            <ul>
              {alerts.map((a) => (
                <li key={a.id}>
                  {a.symbol} {a.type} {a.price} <button onClick={() => removeAlert(a.id)}>x</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <footer style={{ marginTop: 20, fontSize: 12, color: "#666" }}>Demo and prototype — not financial advice.</footer>
    </div>
  );
}
