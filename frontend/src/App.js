import React, { useState, useEffect, useRef } from "react";

const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const REFRESH_INTERVAL = 60000; // 60 seconds per Alpha Vantage limits

// Small SVG sparkline chart
function Sparkline({ data = [], width = 280, height = 60 }) {
  if (!data.length) return <div style={{ height }}>No chart</div>;
  const max = Math.max(...data);
  const min = Math.min(...data);

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / (max - min || 1)) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height}>
      <polyline
        fill="none"
        stroke="#2b8aef"
        strokeWidth="2"
        points={points}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function App() {
  const [symbol, setSymbol] = useState("AAPL");

  // Quote + recommendation
  const [quote, setQuote] = useState(null);
  const [rec, setRec] = useState(null);

  // Chart data (closing prices)
  const [closes, setCloses] = useState([]);

  // Cooldown timer
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef(null);

  // Watchlist
  const watchlist = ["AAPL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "GOOG"];

  // Fetch quote (with cooldown)
  async function fetchQuote(manual = false) {
    if (!manual && cooldown > 0) return;
    try {
      const url =
        (API ? `${API}` : "") +
        `/api/quote?symbol=${encodeURIComponent(symbol)}`;
      const r = await fetch(url);
      const j = await r.json();
      setQuote(j);
    } catch (e) {
      console.error("quote error", e);
    }
    setCooldown(60); // reset cooldown
  }

  // Timer countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Auto-refresh quote every 60 seconds
  useEffect(() => {
    fetchQuote(true);
    const t = setInterval(() => fetchQuote(true), REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [symbol]);

  // Fetch recommendation + closing prices
  async function fetchRec() {
    try {
      const url =
        (API ? `${API}` : "") +
        `/api/recommend?symbol=${encodeURIComponent(symbol)}`;
      const r = await fetch(url);
      const j = await r.json();
      setRec(j);

      if (j && j.rec && j.rec.recentCloses) {
        setCloses(j.rec.recentCloses); // if returned by backend
      }
    } catch (e) {
      console.error("rec error", e);
      setRec({ error: "Failed to fetch recommendation" });
    }
  }

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        padding: 20,
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0 }}>Stock Prototype</h1>
        <div style={{ fontSize: 12 }}>
          Backend:{" "}
          <code
            style={{
              background: "#f3f3f3",
              padding: "3px 6px",
              borderRadius: 4,
            }}
          >
            {API}
          </code>
        </div>
      </header>

      {/* Watchlist */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {watchlist.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            style={{
              padding: "8px 12px",
              background: s === symbol ? "#007bff" : "#e6e6e6",
              color: s === symbol ? "#fff" : "#000",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Symbol input + actions */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          style={{ padding: "6px 10px" }}
        />
        <button onClick={() => fetchQuote(true)}>Manual Refresh</button>
        <button onClick={fetchRec}>Get Recommendation</button>
        <div style={{ fontSize: 12, color: "#666" }}>
          Next update: {cooldown}s
        </div>
      </div>

      {/* Quote Card */}
      <section
        style={{
          border: "1px solid #ddd",
          padding: 15,
          borderRadius: 8,
          marginBottom: 20,
        }}
      >
        <h3>Quote</h3>
        {quote && quote.data ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{symbol}</div>
            <div>Current: {quote.data.c}</div>
            <div>Open: {quote.data.o}</div>
            <div>High: {quote.data.h}</div>
            <div>Low: {quote.data.l}</div>
            <div>Prev Close: {quote.data.pc}</div>
            <div style={{ marginTop: 10 }}>
              <strong>Chart (last closes)</strong>
              <Sparkline data={closes.length ? closes : [1, 2, 3]} />
            </div>
          </>
        ) : (
          <div>No data</div>
        )}
      </section>

      {/* Recommendation */}
      <section style={{ border: "1px solid #ddd", padding: 15, borderRadius: 8 }}>
        <h3>Recommendation</h3>
        {rec && rec.rec ? (
          <>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              Score: {rec.rec.score}
            </div>
            <div>{rec.rec.reason}</div>
            <div style={{ marginTop: 10 }}>
              MA50: {rec.rec.ma50} <br />
              MA200: {rec.rec.ma200}
            </div>
          </>
        ) : rec && rec.error ? (
          <div style={{ color: "red" }}>{rec.error}</div>
        ) : (
          <div>Click “Get Recommendation”</div>
        )}
      </section>

      <footer style={{ marginTop: 20, fontSize: 12, color: "#666" }}>
        Demo only — mock data only unless in Live mode.
      </footer>
    </div>
  );
}
