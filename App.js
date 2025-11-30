import React,{useState,useEffect} from 'react';
export default function App(){
 const [symbol,setSymbol]=useState('AAPL');
 const [quote,setQuote]=useState(null);
 const [rec,setRec]=useState(null);

 useEffect(()=>{
   async function q(){
     const r=await fetch(`/api/quote?symbol=${symbol}`);
     setQuote(await r.json());
   }
   q();
   const t=setInterval(q,3000);
   return()=>clearInterval(t);
 },[symbol]);

 async function getRec(){
   const r=await fetch(`/api/recommend?symbol=${symbol}`);
   setRec(await r.json());
 }

 return <div style={{padding:20}}>
  <h1>Mock Stock Prototype</h1>
  <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())}/>
  <button onClick={getRec}>Recommend</button>
  <h3>Quote</h3><pre>{JSON.stringify(quote,null,2)}</pre>
  <h3>Recommendation</h3><pre>{JSON.stringify(rec,null,2)}</pre>
 </div>;
}