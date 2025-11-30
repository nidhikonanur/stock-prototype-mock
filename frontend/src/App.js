// frontend/src/App.js
import React, { useState, useEffect, useRef } from "react";
const API = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const REFRESH = 60000; // 60s

// small helpers
const fmt = n => (typeof n==='number'?n.toFixed(2):String(n));
const tsToLocal = ts => ts ? new Date(ts*1000).toLocaleString() : 'n/a';

// minimal candlestick SVG (very small, no pan/zoom)
function CandleChart({ timestamps=[], opens=[], highs=[], lows=[], closes=[], width=600, height=200 }) {
  if (!timestamps.length) return <div style={{height}} >No chart</div>;
  const len = closes.length;
  const pad = 10;
  const w = width - pad*2;
  const step = len>1 ? w/(len-1) : w;
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const scaleY = v => height - pad - ((v - min)/(max-min||1))*(height - pad*2);
  const points = [];
  for (let i=0;i<len;i++){
    const x = pad + i*step;
    const o = opens[i], h=highs[i], l=lows[i], c=closes[i];
    if (![o,h,l,c].every(v=>typeof v==='number')) continue;
    const yO = scaleY(o), yH = scaleY(h), yL = scaleY(l), yC = scaleY(c);
    points.push({x,yO,yH,yL,yC, color: c>=o?'#2ecc71':'#e74c3c' });
  }
  return (
    <svg width={width} height={height}>
      {points.map((p,i)=>(
        <g key={i}>
          <line x1={p.x} x2={p.x} y1={p.yH} y2={p.yL} stroke={p.color} strokeWidth={1} />
          <rect x={p.x - Math.max(1, step*0.25)} y={Math.min(p.yO,p.yC)} width={Math.max(1, step*0.5)} height={Math.max(1, Math.abs(p.yC-p.yO))} fill={p.color} />
        </g>
      ))}
    </svg>
  );
}

export default function App(){
  const [symbol,setSymbol] = useState("AAPL");
  const [mode,setMode] = useState("mock"); // mock | live
  const [quote,setQuote] = useState(null);
  const [rec,setRec] = useState(null);
  const [hist,setHist] = useState(null); // {timestamps,opens,highs,lows,closes}
  const [ind,setInd] = useState(null);
  const [summary,setSummary] = useState('');
  const [searchResults,setSearchResults] = useState([]);
  const [watchlist,setWatchlist] = useState(["AAPL","MSFT","AMZN","TSLA","NVDA","META","GOOG"]);
  const [portfolio,setPortfolio] = useState(() => JSON.parse(localStorage.getItem('portfolio')||'[]'));
  const [alerts,setAlerts] = useState([]);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  // cooldown timer
  useEffect(()=> {
    cooldownRef.current = setInterval(()=> setCooldown(c=> Math.max(0,c-1)), 1000);
    return ()=> clearInterval(cooldownRef.current);
  },[]);

  // load quote + hist on symbol change or mode
  useEffect(()=>{
    let mounted=true;
    async function loadAll(){
      // quote
      if (mode==='mock') {
        setQuote({symbol:'AAPL', data:{c:194.35,o:195.2,h:196,l:193.1,pc:194,t:1701360000}});
      } else {
        try {
          const r = await fetch(`${API}/api/quote?symbol=${symbol}`);
          const j = await r.json();
          setQuote(j);
        } catch(e){ setQuote(null); }
      }
      // history
      if (mode==='mock') {
        const closes = Array.from({length:40},(_,i)=>180+i*1.2);
        setHist({timestamps:[],opens:[],highs:[],lows:[],closes});
      } else {
        try {
          const r = await fetch(`${API}/api/history?symbol=${symbol}&range=1y&interval=1d`);
          const j = await r.json();
          if (j && j.closes) setHist({timestamps:j.timestamps, opens:j.opens, highs:j.highs, lows:j.lows, closes:j.closes});
        } catch(e){ setHist(null); }
      }
      // indicators
      if (mode==='live') {
        try {
          const r2 = await fetch(`${API}/api/indicators?symbol=${symbol}`);
          const j2 = await r2.json();
          setInd(j2);
        } catch(e){ setInd(null); }
        try {
          const r3 = await fetch(`${API}/api/summary?symbol=${symbol}`);
          const j3 = await r3.json();
          setSummary(j3.summary || '');
        } catch(e){ setSummary(''); }
      } else {
        setInd(null); setSummary('');
      }
      setCooldown(60);
      // auto-clear cooldown every second handled above
    }
    loadAll();
    const id = setInterval(()=>{ if (mode==='live') loadAll(); }, REFRESH);
    return ()=>{ mounted=false; clearInterval(id); };
  },[symbol,mode]);

  // search autocomplete
  async function handleSearch(q){
    if (!q) return setSearchResults([]);
    try{
      const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      setSearchResults(j.result || []);
    }catch(e){ setSearchResults([]); }
  }

  // get recommendation
  async function getRecommendation(){
    if (mode==='mock') { setRec({rec:{score:100,reason:'Bullish',ma50:237.25,ma200:199.75,recentClose:249.5}}); return; }
    try{
      const r = await fetch(`${API}/api/recommend?symbol=${symbol}`);
      const j = await r.json();
      setRec(j);
    }catch(e){ setRec({error:'Failed to fetch recommendation'}); }
  }

  // add to portfolio
  function addToPortfolio(sym,qty){
    const p = [...portfolio, { id:Date.now().toString(36), symbol:sym, qty:Number(qty) }];
    setPortfolio(p); localStorage.setItem('portfolio', JSON.stringify(p));
  }
  function removeFromPortfolio(id){
    const p = portfolio.filter(x=>x.id!==id); setPortfolio(p); localStorage.setItem('portfolio', JSON.stringify(p));
  }

  // alerts: register locally + server
  async function createAlert(sym, type, price, webhook){
    try{
      const r = await fetch(`${API}/api/alerts`, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ symbol: sym, type, price, webhook })});
      const j = await r.json();
      if (j && j.id) {
        const newAlerts = [...alerts, { id:j.id, symbol: sym, type, price, webhook }];
        setAlerts(newAlerts);
      }
    }catch(e){ console.error(e); }
  }
  async function removeAlert(id){
    await fetch(`${API}/api/alerts/${id}`, { method:'DELETE' });
    setAlerts(alerts.filter(a=>a.id!==id));
  }
  // check alerts (manual) — server will evaluate and call webhooks if any triggered
  async function checkAlerts(){
    const r = await fetch(`${API}/api/check-alerts`, {method:'POST'});
    const j = await r.json();
    if (j && j.triggered && j.triggered.length) alert(`Alerts triggered: ${j.triggered.map(t=>t.symbol).join(', ')}`);
  }

  // watchlist helpers
  function addWatch(sym){ if (!watchlist.includes(sym)) setWatchlist([...watchlist, sym]); }
  function removeWatch(sym){ setWatchlist(watchlist.filter(s=>s!==sym)); }

  // UI
  return (
    <div style={{padding:20, fontFamily:'Inter, Arial, sans-serif', maxWidth:1000, margin:'0 auto'}}>
      <header style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1 style={{margin:0}}>Stock Prototype — All Features</h1>
        <div style={{fontSize:12}}>Backend: <code style={{background:'#eee',padding:'3px 6px'}}>{API||'(same origin)'}</code></div>
      </header>

      {/* mode + search */}
      <div style={{marginTop:12, display:'flex', gap:10, alignItems:'center'}}>
        <label><input type="radio" checked={mode==='mock'} onChange={()=>setMode('mock')} /> Mock</label>
        <label><input type="radio" checked={mode==='live'} onChange={()=>setMode('live')} /> Live</label>

        <input placeholder="Search symbol..." onChange={(e)=>handleSearch(e.target.value)} style={{marginLeft:20}} />
        <div>
          {searchResults.slice(0,6).map(r=>(
            <button key={r.symbol} style={{margin:4}} onClick={()=>setSymbol(r.symbol)}>{r.symbol} {r.name?`(${r.name})`:''}</button>
          ))}
        </div>
      </div>

      {/* watchlist */}
      <div style={{marginTop:12, display:'flex', gap:8, flexWrap:'wrap'}}>
        {watchlist.map(w=>(
          <button key={w} onClick={()=>setSymbol(w)} style={{padding:'6px 10px', background: w===symbol? '#007bff':'#eee', color:w===symbol? '#fff':'#000', border:'none', borderRadius:6}}>{w}</button>
        ))}
        <button onClick={()=>{ const s = prompt('Symbol to add'); if (s) addWatch(s.toUpperCase()); }}>+ add</button>
      </div>

      {/* top controls */}
      <div style={{marginTop:12, display:'flex', gap:10, alignItems:'center'}}>
        <div><strong>Symbol:</strong> <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} /></div>
        <button onClick={getRecommendation}>Get recommendation</button>
        <button onClick={()=>{ setCooldown(60); /* triggers refresh via useEffect */ }}>Manual Refresh</button>
        <div style={{marginLeft:10}}>Next update: {cooldown}s</div>
        <div style={{marginLeft:20}}><button onClick={checkAlerts}>Check Alerts</button></div>
      </div>

      {/* main grid */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 360px', gap:16, marginTop:16}}>
        {/* left: chart + quote + indicators */}
        <div>
          <section style={{border:'1px solid #ddd', padding:12, borderRadius:8}}>
            <h3 style={{marginTop:0}}>Quote</h3>
            {quote && quote.data ? (
              <>
                <div style={{fontSize:20, fontWeight:700}}>{quote.symbol}</div>
                <div>Timestamp: {tsToLocal(quote.data.t)}</div>
                <div style={{display:'flex', gap:12, marginTop:8}}>
                  <div>Current: <strong>{fmt(quote.data.c)}</strong></div>
                  <div>Open: {fmt(quote.data.o)}</div>
                  <div>High: {fmt(quote.data.h)}</div>
                  <div>Low: {fmt(quote.data.l)}</div>
                  <div>Prev Close: {fmt(quote.data.pc)}</div>
                </div>
              </>
            ) : <div>No data</div>}
          </section>

          <section style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:12}}>
            <h3 style={{marginTop:0}}>Chart</h3>
            {hist && hist.closes ? (
              <CandleChart timestamps={hist.timestamps} opens={hist.opens} highs={hist.highs} lows={hist.lows} closes={hist.closes} />
            ) : <div>No history</div>}
          </section>

          <section style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:12}}>
            <h3 style={{marginTop:0}}>Indicators</h3>
            {ind ? (
              <div>
                <div>MA50: {ind.ma50?fmt(ind.ma50):'n/a'}</div>
                <div>MA200: {ind.ma200?fmt(ind.ma200):'n/a'}</div>
                <div>EMA20: {ind.ema20?fmt(ind.ema20):'n/a'}</div>
                <div>RSI14: {ind.rsi14?fmt(ind.rsi14):'n/a'}</div>
                <div>MACD: {ind.macd && ind.macd.macd? Number(ind.macd.macd).toFixed(3) : 'n/a'}</div>
              </div>
            ) : <div>No indicators</div>}
          </section>

          <section style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:12}}>
            <h3 style={{marginTop:0}}>Summary</h3>
            <div>{summary || 'Click Get recommendation to generate summary.'}</div>
          </section>
        </div>

        {/* right column: rec, portfolio, alerts */}
        <div>
          <section style={{border:'1px solid #ddd', padding:12, borderRadius:8}}>
            <h3 style={{marginTop:0}}>Recommendation</h3>
            {rec && rec.rec ? (
              <>
                <div style={{fontSize:28, fontWeight:700}}>{rec.rec.score}</div>
                <div>{rec.rec.reason}</div>
                <div>Recent Close: {rec.rec.recentClose}</div>
                <div>MA50: {fmt(rec.rec.ma50)} MA200: {fmt(rec.rec.ma200)}</div>
              </>
            ) : rec && rec.error ? <div style={{color:'red'}}>{rec.error}</div> : <div>Click Get recommendation</div>}
          </section>

          <section style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:12}}>
            <h3 style={{marginTop:0}}>Portfolio</h3>
            <div>
              <button onClick={()=>{ const s=prompt('symbol'); const q=prompt('qty'); if(s && q) addToPortfolio(s.toUpperCase(), Number(q)); }}>Add position</button>
            </div>
            <ul>
              {portfolio.map(p=>(
                <li key={p.id}>
                  {p.symbol} — {p.qty}
                  <button style={{marginLeft:8}} onClick={()=>removeFromPortfolio(p.id)}>remove</button>
                </li>
              ))}
            </ul>
          </section>

          <section style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:12}}>
            <h3 style={{marginTop:0}}>Alerts</h3>
            <div>
              <button onClick={()=>{ const s=prompt('symbol'); const type=prompt('type: gt or lt'); const price=prompt('price'); const webhook=prompt('optional webhook url'); if(s && type && price) createAlert(s.toUpperCase(), type, Number(price), webhook || null); }}>Create alert</button>
            </div>
            <ul>
              {alerts.map(a=>(
                <li key={a.id}>
                  {a.symbol} {a.type} {a.price} <button onClick={()=>removeAlert(a.id)}>x</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <footer style={{marginTop:20, fontSize:12, color:'#666'}}>Demo and prototype — not financial advice.</footer>
    </div>
  );
}
