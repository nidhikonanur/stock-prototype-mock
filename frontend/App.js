import React, { useState, useEffect } from 'react';

const API = (process.env.REACT_APP_API_URL || '').replace(/\/$/, ''); // remove trailing slash

export default function App() {
  const [symbol, setSymbol] = useState('AAPL');
  const [quote, setQuote] = useState(null);
  const [rec, setRec] = useState(null);
  const [qErr, setQErr] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function q() {
      try {
        const url = (API ? `${API}` : '') + `/api/quote?symbol=${encodeURIComponent(symbol)}`;
        const r = await fetch(url);
        const j = await r.json();
        if (!mounted) return;
        setQuote(j);
        setQErr(null);
      } catch (e) {
        if (!mounted) return;
        setQErr(e.message || 'fetch error');
      }
    }
    q();
    const t = setInterval(q, 3000);
    return () => { mounted = false; clearInterval(t); };
  }, [symbol]);

  async function getRec() {
    try {
      const url = (API ? `${API}` : '') + `/api/recommend?symbol=${encodeURIComponent(symbol)}`;
      const r = await fetch(url);
      const j = await r.json();
      setRec(j);
    } catch (e) {
      setRec({ error: e.message || 'fetch error' });
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif', maxWidth: 720 }}>
      <h1>Mock Stock Prototype</h1>

      <div style={{ marginBottom: 12 }}>
        <label style={{ marginRight: 8 }}>Symbol:</label>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} />
        <button style={{ marginLeft: 8 }} onClick={getRec}>Recommend</button>
      </div>

      <section style={{ border: '1px solid #eee', padding: 12, marginBottom: 12 }}>
        <strong>Quote</strong>
        <div style={{ marginTop: 8 }}>
          {qErr && <div style={{ color: 'red' }}>Error: {qErr}</div>}
          {quote ? <pre>{JSON.stringify(quote, null, 2)}</pre> : <div>Loading...</div>}
        </div>
      </section>

      <section style={{ border: '1px solid #eee', padding: 12 }}>
        <strong>Recommendation</strong>
        <div style={{ marginTop: 8 }}>
          {rec ? <pre>{JSON.stringify(rec, null, 2)}</pre> : <div>Press Recommend to compute</div>}
        </div>
      </section>

      <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
        Backend URL used: <strong>{API || '(same origin)'}</strong>
        <div>Disclaimer: Demo only — not financial advice.</div>
      </div>
    </div>
  );
}
