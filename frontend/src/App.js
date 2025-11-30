// Replace your current App.js with this exact code
import React, { useState, useEffect } from "react";
const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
function fmt(n){ return typeof n==='number'? n.toFixed(2): String(n); }
function tsToLocal(ts){ return ts? new Date(ts*1000).toLocaleString():'n/a'; }

// tiny sparkline: expects an array of numbers
function Sparkline({ data = [], width = 220, height = 40 }) {
  if (!data || data.length === 0) return <div style={{height:height}}>No history</div>;
  const max = Math.max(...data), min = Math.min(...data);
  const points = data.map((v,i)=>{
    const x = (i/(data.length-1)) * width;
    const y = height - ((v - min) / (max - min || 1)) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" stroke="#2b8aef" strokeWidth="2" points={points} strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

export default function App(){
  const [symbol,setSymbol] = useState('AAPL');
  const [quote,setQuote] = useState(null);
  const [rec,setRec] = useState(null);
  const [closes,setCloses] = useState([]);

  useEffect(()=>{
    let mounted = true;
    async function fetchQuote(){
      try {
        const url = (API? `${API}` : '') + `/api/quote?symbol=${encodeURIComponent(symbol)}`;
        const r = await fetch(url);
        const j = await r.json();
        if(!mounted) return;
        setQuote(j);
      } catch(e){ console.error(e); }
    }
    fetchQuote();
    const t = setInterval(fetchQuote, 5000);
    return ()=>{ mounted=false; clearInterval(t); };
  },[symbol]);

  async function getRec(){
    try{
      const url = (API? `${API}` : '') + `/api/recommend?symbol=${encodeURIComponent(symbol)}`;
      const r = await fetch(url);
      const j = await r.json();
      setRec(j);
      // if sample or live returns full candle closes, try to extract closes
      if(j && j.rec && j.rec.recentCloses) setCloses(j.rec.recentCloses);
      // fallback: if backend returns sample file structure j.c, handle here by calling history endpoint if exists
      // (optional: you can modify backend to return closes in response)
    }catch(e){ setRec({ error: e.message }); }
  }

  return (
    <div style={{padding:20,fontFamily:'Inter, Arial, sans-serif',maxWidth:900,margin:'0 auto'}}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h1 style={{margin:0}}>Stock Prototype (Mock)</h1>
        <div style={{fontSize:12,color:'#666'}}>Backend: <code style={{background:'#f3f3f3',padding:'2px 6px',borderRadius:4}}>{API||'(same origin)'}</code></div>
      </header>

      <div style={{display:'flex',gap:12,marginTop:14,marginBottom:14}}>
        <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} style={{padding:'6px 8px'}}/>
        <button onClick={getRec}>Get recommendation</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:16}}>
        <section style={{border:'1px solid #eee',padding:12,borderRadius:8}}>
          <h3>Quote</h3>
          {quote && quote.data ? (
            <div style={{display:'flex',gap:12}}>
              <div style={{minWidth:160}}>
                <div style={{fontWeight:700,fontSize:18}}>{quote.symbol}</div>
                <div style={{color:'#666',marginTop:6}}>Timestamp: {tsToLocal(quote.data.t)}</div>
              </div>
              <div style={{flex:1}}>
                <div>Current: <strong>{fmt(quote.data.c)}</strong></div>
                <div>Open: {fmt(quote.data.o)}</div>
                <div>High: {fmt(quote.data.h)}</div>
                <div>Low: {fmt(quote.data.l)}</div>
                <div>Prev close: {fmt(quote.data.pc)}</div>
                <div style={{marginTop:8}}><Sparkline data={closes.length?closes: Array.from({length:30},(_,i)=>140+i)} /></div>
              </div>
            </div>
          ) : <div>No quote yet</div>}
        </section>

        <aside style={{border:'1px solid #eee',padding:12,borderRadius:8}}>
          <h3>Recommendation</h3>
          {rec && rec.rec ? (
            <>
              <div style={{fontWeight:700,fontSize:20}}>{rec.rec.score}</div>
              <div>{rec.rec.reason}</div>
            </>
          ) : rec && rec.error ? <div style={{color:'red'}}>{rec.error}</div> : <div>Click Get recommendation</div>}
        </aside>
      </div>
    </div>
  );
}
