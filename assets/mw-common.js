/* Marine Weather Jamaica: shared helpers for the outlook and bank sections. */
(()=>{'use strict';
const RANK={GREEN:1,AMBER:2,RED:3};
const WORD={GREEN:'GOOD',AMBER:'CAUTION',RED:'ALERT'};
const TZ='America/Jamaica';

// Same mapping as the poster generators: YELLOW/AMBER = CAUTION, RED = ALERT.
function status(v){
  const s=String(v??'').trim().toUpperCase();
  if(s==='YELLOW'||s==='ORANGE'||s==='FAIR'||s==='CAUTION')return 'AMBER';
  if(s==='GOOD')return 'GREEN';
  return RANK[s]?s:null;
}
function worst(...values){
  let w=null;
  for(const v of values.flat()){const s=status(v);if(s&&(!w||RANK[s]>RANK[w]))w=s;}
  return w;
}
const word=s=>WORD[status(s)]||'NOT RATED';
const cls=s=>({GREEN:'green',AMBER:'amber',RED:'red'})[status(s)]||'unknown';

function jaDate(offsetDays=0){
  return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'})
    .format(new Date(Date.now()+offsetDays*86400000));
}
function jaHour(){
  return Number(new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hourCycle:'h23'}).format(new Date()));
}
// generatedAt values sometimes carry a "-uuid" suffix after the ISO time.
function parseTime(v){
  if(!v)return null;
  const m=String(v).match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  const d=new Date(m?m[0]:v);
  return Number.isFinite(d.getTime())?d:null;
}
function updatedText(v){
  const d=parseTime(v);if(!d)return '';
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  const time=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(d);
  if(day===jaDate())return 'today '+time;
  if(day===jaDate(-1))return 'yesterday '+time;
  return new Intl.DateTimeFormat('en-GB',{timeZone:TZ,weekday:'short',day:'numeric',month:'short'}).format(d)+' '+time;
}
const ageHours=v=>{const d=parseTime(v);return d?(Date.now()-d.getTime())/3600000:Infinity;};
function dayLabel(iso,opts={weekday:'short',day:'numeric'}){
  return new Intl.DateTimeFormat('en-GB',{...opts,timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'));
}
const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fmt=(v,dec=1)=>{const n=num(v);return n===null?'—':n.toFixed(dec);};
const COMPASS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const compass=deg=>{const n=num(deg);return n===null?'':COMPASS[Math.round(((n%360)+360)%360/22.5)%16];};
const M_TO_FT=3.28084;

async function getJSON(url){
  const r=await fetch(url,{cache:'no-store'});
  if(!r.ok)throw Error(url+' returned '+r.status);
  return r.json();
}
// Small DOM helper: el('p',{class:'x'},'text', child)
function el(tag,attrs={},...kids){
  const n=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(v===null||v===undefined||v===false)continue;
    if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else n.setAttribute(k,v===true?'':v);
  }
  for(const k of kids.flat()){if(k===null||k===undefined||k===false)continue;n.append(k instanceof Node?k:document.createTextNode(String(k)));}
  return n;
}
function pill(s,extra){
  const w=word(s);
  return el('span',{class:'rating-pill '+cls(s)},el('span',{class:'pill-icon','aria-hidden':'true'},s&&status(s)!=='GREEN'?'⚠':'●'),w,extra?el('small',{},extra):null);
}

window.MW={status,worst,word,cls,jaDate,jaHour,parseTime,updatedText,ageHours,dayLabel,num,fmt,compass,M_TO_FT,getJSON,el,pill};
})();
