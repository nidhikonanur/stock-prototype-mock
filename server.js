require('dotenv').config();
const express=require('express');
const fetch=require('node-fetch');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
const {recommendationFromCloses}=require('./recommend');
const app=express(); app.use(cors());
const KEY=process.env.FINNHUB_KEY;
const PORT=process.env.PORT||3001;
const MOCK=process.env.MOCK==='true';

app.get('/api/quote',async(req,res)=>{
  const symbol=(req.query.symbol||'AAPL').toUpperCase();
  try{
    if(MOCK){
      const p=path.join(__dirname,'sample_data','sample_quote.json');
      const raw=fs.readFileSync(p,'utf8');
      const j=JSON.parse(raw);
      j.symbol=symbol;
      return res.json(j);
    }
    const url=`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${KEY}`;
    const r=await fetch(url); const data=await r.json();
    res.json({symbol,data});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/recommend',async(req,res)=>{
  const symbol=(req.query.symbol||'AAPL').toUpperCase();
  try{
    if(MOCK){
      const p=path.join(__dirname,'sample_data','sample_candles.json');
      const raw=fs.readFileSync(p,'utf8');
      const j=JSON.parse(raw);
      const rec=recommendationFromCloses(j.c);
      return res.json({symbol,rec});
    }
    const now=Math.floor(Date.now()/1000);
    const from=now-450*24*3600;
    const url=`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${now}&token=${KEY}`;
    const r=await fetch(url); const j=await r.json();
    const rec=recommendationFromCloses(j.c);
    res.json({symbol,rec});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log('Backend running',PORT));
