import React, { useState, useEffect } from "react";

const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

function fmt(n) {
  return typeof n === "number" ? n.toFixed(2) : String(n);
}
function tsToLocal(ts) {
  if (!ts) return "n/a";
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function App() {
  const [symbol, setSymbol] = useState("AAPL");
  const [quote, setQuote] = useState(null);
  const [rec, setRec] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingRec, setLoadingRec] = useState(false);
  const [qErr, setQErr] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function fetchQuote() {
      setLoadingQuote(true);
      setQErr(null);
      try {
        const url = (API ? `${API}` : "") + `/api/quote?symbol=${encodeURIComponent(symbol)}`;
        const r = await fetch(url);
        const j = await r.json();
        if (!mounted) return;
        setQuote(j);
      } catch (e) {
        if (!mounted) return;
        setQErr(e.message || "Failed to fetch quote");
      } finally {
        if (mounted) setLoadingQuote(false);
      }
    }
    fetchQuote();
    const t = setInterval(fetchQuote, 5000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [symbol]);

  async function getRec() {
    setLoadingRec(true);
    setRec(null);
    try {
      const url = (API ? `${API}` : "") + `/api/recommend?symbol=${encodeURIComponent(symbol)}`;
      const r = await fetch(url);
      const j = await r.json();
      setRec(j);
    } catch (e) {
      setRec({ error: e.message || "Failed to compute recommendation" });
    } finally {
      setLoadingRec(false);
    }
  }

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif", padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Stock Prototype (Mock)</h1>
        <div style={{ fontSize: 12, color: "#666" }}>Backend: <code style={{background:"#f3f3f3",padding:"2px 6px",borderRadius:4}}>{API || "(same origin)"}</code></div>
      </header>

      <div style={{ display: "flex", gap: 16, marginBottom: 18, alignItems: "center" }}>
        <div>
          <label style={{ fontSize: 13, marginRight: 6 }}>Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{ padding: "6px 8px", fontSize: 14, width: 120 }}
          />
        </div>

        <div>
          <button onClick={getRec} disabled={loadingRec} style={{ padding: "8px 14px", cursor: "pointer" }}>
            {loadingRec ? "Computing…" : "Get recommendation"}
          </button>
        </div>

        <div style={{ marginLeft: "auto", fontSize: 12, color: "#777" }}>
          <em>Demo only — not financial advice</em>
        </div>
      </div>

      <main style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18 }}>
        {/* Quote card */}
        <section style={{ border: "1px solid #e6e6e6", borderRadius: 8, padding: 14, background: "#fff" }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Quote</h3>

          {loadingQuote && <div style={{ color: "#333" }}>Loading quote…</div>}
          {qErr && <div style={{ color: "red" }}>{qErr}</div>}

          {quote && quote.data ? (
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontSize: 13, color: "#555" }}>Symbol</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{quote.symbol || symbol}</div>
                <div style={{ marginTop: 10, color: "#444" }}>Timestamp: {tsToLocal(quote.data.t)}</div>
              </div>

              <div style={{ flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "6px 8px", color: "#666" }}>Current</td>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>{fmt(quote.data.c)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 8px", color: "#666" }}>Open</td>
                      <td style={{ padding: "6px 8px" }}>{fmt(quote.data.o)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 8px", color: "#666" }}>High</td>
                      <td style={{ padding: "6px 8px" }}>{fmt(quote.data.h)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 8px", color: "#666" }}>Low</td>
                      <td style={{ padding: "6px 8px" }}>{fmt(quote.data.l)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 8px", color: "#666" }}>Prev close</td>
                      <td style={{ padding: "6px 8px" }}>{fmt(quote.data.pc)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            !loadingQuote && <div style={{ color: "#666" }}>No quote available</div>
          )}
        </section>

        {/* Recommendation card */}
        <aside style={{ border: "1px solid #e6e6e6", borderRadius: 8, padding: 14, background: "#fff" }}>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>Recommendation</h3>

          {loadingRec && <div>Computing recommendation…</div>}

          {rec && rec.rec ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 13, color: "#666" }}>Score</div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>{rec.rec.score}</div>
                <div style={{ marginLeft: "auto", fontSize: 13, color: "#333" }}>{rec.rec.reason}</div>
              </div>

              <div style={{ height: 12, background: "#f1f1f1", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, rec.rec.score || 0))}%`,
                    height: "100%",
                    background: rec.rec.score >= 60 ? "#2ecc71" : rec.rec.score >= 40 ? "#f1c40f" : "#e74c3c",
                  }}
                />
              </div>

              <div style={{ fontSize: 13, color: "#555" }}>
                <div>Recent close: <strong>{fmt(rec.rec.recentClose)}</strong></div>
                <div>MA50: <strong>{fmt(rec.rec.ma50)}</strong></div>
                <div>MA200: <strong>{fmt(rec.rec.ma200)}</strong></div>
              </div>
            </div>
          ) : rec && rec.error ? (
            <div style={{ color: "red" }}>{rec.error}</div>
          ) : (
            <div style={{ color: "#666" }}>Click "Get recommendation" to compute.</div>
          )}
        </aside>
      </main>

      <footer style={{ marginTop: 18, fontSize: 12, color: "#888" }}>
        <div>Demo — mock data only. Do not use for trading.</div>
      </footer>
    </div>
  );
}
