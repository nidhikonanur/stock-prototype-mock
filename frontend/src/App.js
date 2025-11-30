import React, { useState, useEffect } from "react";

const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

// Format numbers
function fmt(n) {
  return typeof n === "number" ? n.toFixed(2) : String(n);
}

// Convert epoch seconds to local date/time
function tsToLocal(ts) {
  try {
    return ts ? new Date(ts * 1000).toLocaleString() : "n/a";
  } catch {
    return "n/a";
  }
}

// ----- Sparkline chart (mini SVG, no libraries) -----
function Sparkline({ data = [], width = 220, height = 40 }) {
  if (!data || data.length < 2) return <div style={{ height }}>No data</div>;

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
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        points={points}
        stroke="#1e88e5"
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ----- Mock Data -----
const MOCK_QUOTE = {
  symbol: "AAPL",
  data: { c: 194.35, h: 196.0, l: 193.1, o: 195.2, pc: 194.0, t: 1701360000 },
};

const MOCK_RECOMMEND = {
  symbol: "AAPL",
  rec: {
    score: 100,
    reason: "Bullish",
    ma50: 237.25,
    ma200: 199.75,
    recentClose: 249.5,
  },
};

// mock closes for sparkline
const MOCK_CLOSES = Array.from({ length: 40 }, (_, i) => 180 + i * 1.2);

export default function App() {
  const [symbol, setSymbol] = useState("AAPL");

  // Toggle between UI Mock and Live
  const [uiMode, setUiMode] = useState("mock"); // "mock" or "live"

  const [quote, setQuote] = useState(null);
  const [rec, setRec] = useState(null);
  const [closes, setCloses] = useState([]);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingRec, setLoadingRec] = useState(false);
  const [error, setError] = useState(null);

  // ----- Quote polling -----
  useEffect(() => {
    let mounted = true;

    async function fetchQuote() {
      if (uiMode === "mock") {
        setQuote(MOCK_QUOTE);
        setCloses(MOCK_CLOSES);
        return;
      }

      try {
        setLoadingQuote(true);
        const url = `${API}/api/quote?symbol=${encodeURIComponent(symbol)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!mounted) return;
        setQuote(json);
        setError(null);

        // Use mock sparkline unless you later build a history endpoint
        setCloses(MOCK_CLOSES);
      } catch (e) {
        if (mounted) setError("Failed to fetch quote");
      } finally {
        if (mounted) setLoadingQuote(false);
      }
    }

    fetchQuote();
    const t = setInterval(fetchQuote, 60000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [symbol, uiMode]);

  // ----- Recommendation -----
  async function getRecommendation() {
    if (uiMode === "mock") {
      setRec(MOCK_RECOMMEND);
      return;
    }

    try {
      setLoadingRec(true);
      const url = `${API}/api/recommend?symbol=${encodeURIComponent(symbol)}`;
      const res = await fetch(url);
      const json = await res.json();
      setRec(json);
    } catch (e) {
      setRec({ error: "Failed to fetch recommendation" });
    } finally {
      setLoadingRec(false);
    }
  }

  return (
    <div
      style={{
        padding: 20,
        fontFamily: "Inter, Arial, sans-serif",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <header
        style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}
      >
        <h1 style={{ margin: 0 }}>Stock Prototype</h1>
        <small style={{ color: "#666" }}>
          Backend:{" "}
          <code style={{ background: "#eee", padding: "2px 6px", borderRadius: 4 }}>
            {API || "(same origin)"}
          </code>
        </small>
      </header>

      {/* Mode Toggle */}
      <div style={{ marginBottom: 16 }}>
        <strong>Mode: </strong>
        <label style={{ marginRight: 10 }}>
          <input
            type="radio"
            name="mode"
            checked={uiMode === "mock"}
            onChange={() => setUiMode("mock")}
          />{" "}
          Mock
        </label>

        <label>
          <input
            type="radio"
            name="mode"
            checked={uiMode === "live"}
            onChange={() => setUiMode("live")}
          />{" "}
          Live
        </label>
      </div>

      {/* Symbol input + button */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          style={{ padding: "6px 8px", width: 120 }}
        />
        <button onClick={getRecommendation} disabled={loadingRec}>
          {loadingRec ? "Loading…" : "Get recommendation"}
        </button>
      </div>

      {/* Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        {/* ----- Quote Card ----- */}
        <section
          style={{ border: "1px solid #ddd", padding: 14, borderRadius: 8, background: "#fff" }}
        >
          <h3 style={{ marginTop: 0 }}>Quote</h3>

          {loadingQuote && <div>Loading…</div>}
          {error && <div style={{ color: "red" }}>{error}</div>}

          {quote && quote.data ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{quote.symbol}</div>
              <div style={{ marginBottom: 6, color: "#666" }}>
                Timestamp: {tsToLocal(quote.data.t)}
              </div>

              <div style={{ display: "flex", gap: 18 }}>
                <div>
                  <div>Current: <strong>{fmt(quote.data.c)}</strong></div>
                  <div>Open: {fmt(quote.data.o)}</div>
                  <div>High: {fmt(quote.data.h)}</div>
                  <div>Low: {fmt(quote.data.l)}</div>
                  <div>Prev Close: {fmt(quote.data.pc)}</div>
                </div>

                {/* Sparkline */}
                <div>
                  <Sparkline data={closes} />
                </div>
              </div>
            </>
          ) : (
            !loadingQuote && <div>No data</div>
          )}
        </section>

        {/* ----- Recommendation Card ----- */}
        <section
          style={{ border: "1px solid #ddd", padding: 14, borderRadius: 8, background: "#fff" }}
        >
          <h3 style={{ marginTop: 0 }}>Recommendation</h3>

          {loadingRec && <div>Loading…</div>}

          {rec && rec.rec ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 32, fontWeight: 700 }}>{rec.rec.score}</div>
                <div style={{ fontSize: 14, color: "#444" }}>{rec.rec.reason}</div>
              </div>

              {/* Score Bar */}
              <div
                style={{
                  height: 12,
                  marginTop: 8,
                  background: "#eee",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${rec.rec.score}%`,
                    height: "100%",
                    background:
                      rec.rec.score >= 60
                        ? "#2ecc71"
                        : rec.rec.score >= 40
                        ? "#f1c40f"
                        : "#e74c3c",
                  }}
                />
              </div>

              <div style={{ fontSize: 13, marginTop: 10 }}>
                <div>Recent Close: <strong>{fmt(rec.rec.recentClose)}</strong></div>
                <div>MA50: <strong>{fmt(rec.rec.ma50)}</strong></div>
                <div>MA200: <strong>{fmt(rec.rec.ma200)}</strong></div>
              </div>
            </>
          ) : rec && rec.error ? (
            <div style={{ color: "red" }}>{rec.error}</div>
          ) : (
            <div>Click "Get recommendation"</div>
          )}
        </section>
      </div>

      <footer style={{ marginTop: 20, fontSize: 12, color: "#777" }}>
        Demo only — mock data only unless in Live mode.  
      </footer>
    </div>
  );
}
