function avg(a){return a.reduce((x,y)=>x+y,0)/a.length;}
function recommendationFromCloses(c){
 if(c.length<200) return {score:null,reason:'not enough data'};
 const ma50=avg(c.slice(-50));
 const ma200=avg(c.slice(-200));
 let score=50+Math.round(((ma50-ma200)/ma200)*400);
 score=Math.max(0,Math.min(100,score));
 return {score,reason:ma50>ma200?'Bullish':'Bearish',ma50,ma200,recentClose:c[c.length-1]};
}
module.exports={recommendationFromCloses};
