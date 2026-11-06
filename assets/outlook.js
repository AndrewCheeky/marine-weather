/* Marine Weather Jamaica: 7-day outlook as readable text.
   Reads the published seven-day manifest and per-day JSON (the same data the posters are drawn from).
   Visitors pick up to three banks (or "No bank"); the choice is remembered in this browser.
   Day buttons and the warning banner use the WORST rating of the chosen banks. */
(()=>{'use strict';
const M=window.MW;if(!M)return;
const {el}=M;
const base='instagram/generated/';
const strip=document.getElementById('seven-day-select');
const grid=document.getElementById('area-grid');
const updated=document.getElementById('outlook-updated');
const stale=document.getElementById('outlook-stale');
const offshore=document.getElementById('outlook-offshore');
const more=document.getElementById('outlook-more');
const moreGrid=document.getElementById('more-grid');
const foot=document.getElementById('outlook-foot');
const fallback=document.getElementById('poster-fallback');
const fallbackImg=document.getElementById('daily-poster');
if(!strip||!grid)return;

const ok=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&!/^(—|-|n\/a|not available|unavailable|none identified)\b/i.test(String(v).trim());
const short=name=>String(name||'').replace(/\s+bank$/i,'');

function stat(label,value,sub){
  if(!ok(value))return null;
  return el('div',{class:'stat'},el('dt',{},label),el('dd',{},value,ok(sub)?el('small',{},sub):null));
}

/* ---------- Chosen banks (saved in this browser) ---------- */
const PICK_KEY='mw.outlookBanks.v1';
const DEFAULT_PICKS=['maiden','bowditch','california'];
let bankList=[],picks=DEFAULT_PICKS.slice();
try{const saved=JSON.parse(localStorage.getItem(PICK_KEY)||'null');if(Array.isArray(saved)&&saved.length===3)picks=saved.map(x=>typeof x==='string'?x:'');}catch{}
const savePicks=()=>{try{localStorage.setItem(PICK_KEY,JSON.stringify(picks));}catch{}};
const bankName=key=>bankList.find(b=>b.key===key)?.name||key;

// One shape for every area: from the day's `areas` list, or (older files) from the poster fields.
function areasFor(p){
  const map=new Map();
  const line=(raw,re)=>{const m=String(raw||'').match(re);return m?m[1].trim():'';};
  const fromPoster={
    maiden:{status:p.status,comfort:p.comfort,reason:p.overallReason,wind:p.wind,gust:p.gust,seas:p.seas,period:p.period,rain:p.rain,uv:p.uv,
      current:p.current,currentDir:p.currentDir,sst:p.sst,swell:p.swell},
  };
  [[1,'bowditch'],[2,'california']].forEach(([n,key])=>{const k='bank'+n;fromPoster[key]={
    status:p[k+'status'],comfort:p[k+'comfort'],reason:p[k+'reason'],
    wind:line(p[k+'windLine'],/^Wind\s*([^(]+)/i),gust:line(p[k+'windLine'],/\(Gust\s*([^)]+)\)/i),
    seas:line(p[k+'seaLine'],/^Seas\s*([^·]+)/i),period:line(p[k+'seaLine'],/Period\s*(.+)$/i),
    rain:line(p[k+'rain'],/^([^·]+)/),rainChance:line(p[k+'rain'],/peak chance\s*(.+)$/i).replace(/\s+%/,'%'),
    current:p[k+'current'],currentDir:p[k+'currentDir'],sst:p[k+'sst'],swell:p[k+'swell']};});
  for(const [key,a] of Object.entries(fromPoster))map.set(key,{key,...a});
  for(const a of Array.isArray(p.areas)?p.areas:[])if(a&&a.key)map.set(a.key,{...map.get(a.key),...a,uv:a.uv??map.get(a.key)?.uv});
  return map;
}

function areaCard(key,a){
  const status=M.status(a.status);
  const cur=ok(a.current)?a.current+(ok(a.currentDir)?' '+a.currentDir:''):'';
  return el('article',{class:'area-card '+M.cls(status)+(status==='RED'?' highlight':'')},
    el('header',{},
      el('div',{},el('h3',{},bankName(key))),
      M.pill(status,ok(a.comfort)?'Comfort '+a.comfort:null)),
    status&&status!=='GREEN'&&ok(a.reason)?el('p',{class:'area-reason'},'Why: '+a.reason):null,
    el('dl',{class:'area-stats'},[
      stat('Wind',a.wind,ok(a.gust)?'gusts '+a.gust:''),stat('Seas',a.seas,ok(a.period)?'period '+a.period:''),
      stat('Rain',a.rain,ok(a.rainChance)?'peak chance '+String(a.rainChance).replace(/\s+%/,'%'):''),stat('UV index',a.uv),
      stat('Surface current',cur),stat('Sea temperature',a.sst),stat('Swell',a.swell)].filter(Boolean)));
}
function missingCard(key){
  const go=el('a',{href:'#bank-snapshots',class:'missing-link'},'See its 24-hour forecast ↓');
  go.addEventListener('click',()=>{const sel=document.getElementById('bank-select');if(sel&&[...sel.options].some(o=>o.value===key)){sel.value=key;sel.dispatchEvent(new Event('change'));}});
  return el('article',{class:'area-card unknown'},
    el('header',{},el('div',{},el('h3',{},bankName(key)))),
    el('p',{class:'area-reason'},'No 7-day outlook is published for this bank yet. ',go));
}
const chosen=()=>picks.filter(Boolean);
function worstFor(p){const m=areasFor(p);return M.worst(chosen().map(k=>m.get(k)?.status));}

/* ---------- Moon: phase as seen from Jamaica + when it is up / visible ---------- */
const SVGNS='http://www.w3.org/2000/svg';
const svgEl=(tag,a={},text)=>{const e=document.createElementNS(SVGNS,tag);for(const [k,v] of Object.entries(a))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;};
// Moon drawing: lit fraction f, waxing = lit on the right (as seen from the northern hemisphere).
function moonDisc(phase,illum,size=96){
  let f=parseFloat(illum);f=Number.isFinite(f)?Math.max(0,Math.min(1,f/100)):(/full/i.test(phase)?1:/new/i.test(phase)?0:0.5);
  const waxing=/waxing|first/i.test(phase);
  const r=44,cx=50,cy=50,rx=Math.abs(1-2*f)*r;
  const svg=svgEl('svg',{viewBox:'0 0 100 100',width:size,height:size,class:'moon-disc',role:'img','aria-label':`${phase}, ${Math.round(f*100)}% lit`});
  const defs=svgEl('defs');const g=svgEl('radialGradient',{id:'moonLit',cx:'45%',cy:'40%',r:'65%'});
  g.append(svgEl('stop',{offset:'0','stop-color':'#fffbe8'}),svgEl('stop',{offset:'1','stop-color':'#e6dcb8'}));defs.append(g);svg.append(defs);
  svg.append(svgEl('circle',{cx,cy,r,fill:'#1d3a50'}));
  if(f>0.005){
    if(f>0.995)svg.append(svgEl('circle',{cx,cy,r,fill:'url(#moonLit)'}));
    else{
      const outerSweep=waxing?1:0;                       // outer edge on the lit side
      const termSweep=(f<0.5)===waxing?0:1;              // crescent bulges toward the lit side, gibbous away
      svg.append(svgEl('path',{fill:'url(#moonLit)',d:`M${cx} ${cy-r}A${r} ${r} 0 0 ${outerSweep} ${cx} ${cy+r}A${rx} ${r} 0 0 ${termSweep} ${cx} ${cy-r}Z`}));
    }
  }
  // A few soft "seas" so it reads as the moon; drawn faintly over the whole disc.
  for(const [x,y,s] of [[38,36,9],[58,44,7],[46,62,8],[64,64,5]])svg.append(svgEl('circle',{cx:x,cy:y,r:s,fill:'#000',opacity:'.06'}));
  svg.append(svgEl('circle',{cx,cy,r,fill:'none',stroke:'#9fb7c6','stroke-width':1.2,opacity:'.6'}));
  return svg;
}
// Moon phase picture with its name and how much is lit, e.g. "Waning Crescent · 22% lit".
function moonFace(p){
  if(!ok(p.moonPhase))return null;
  return el('div',{class:'moon-face'},moonDisc(p.moonPhase,p.moonIllum,76),
    el('p',{},el('strong',{},p.moonPhase),ok(p.moonIllum)?el('span',{},p.moonIllum+' lit'):null));
}

function render(day){
  const p=day.poster||{};
  const map=areasFor(p);
  const keys=chosen();
  const rated=keys.map(k=>({k,a:map.get(k)})).filter(x=>x.a);
  const worst=M.worst(rated.map(x=>x.a.status));

  // Warning banner whenever a chosen bank is rated CAUTION or ALERT.
  if(worst&&worst!=='GREEN'){
    const hit=rated.filter(x=>M.status(x.a.status)===worst);
    const reasons=[...new Set(hit.map(x=>x.a.reason).filter(ok))];
    offshore.className='outlook-banner '+M.cls(worst);
    offshore.replaceChildren(el('strong',{},'⚠ '+(worst==='RED'?'Alert':'Caution')+': '),hit.map(x=>short(bankName(x.k))).join(' & '),
      reasons.length?' — '+reasons.join('; '):'',
      el('span',{class:'banner-sub'},'Check official marine advisories before heading out.'));
    offshore.hidden=false;
  }else offshore.hidden=true;

  grid.replaceChildren(...(keys.length
    ?keys.map(k=>map.get(k)?areaCard(k,map.get(k)):missingCard(k))
    :[el('p',{class:'area-missing'},'Choose up to three banks above to see their 7-day outlook.')]));

  // Secondary details live behind a disclosure so the headline stays short on phones.
  const blocks=[];
  const tides=[stat('High tide',p.highTides),stat('Low tide',p.lowTides)].filter(Boolean);
  if(tides.length)blocks.push(el('div',{class:'more-block'},el('h4',{},'Tides · Kingston (model)'),el('dl',{},tides)));
  const sky=[stat('Sunrise',p.sunrise),stat('Sunset',p.sunset),stat('Moonrise',p.moonrise),stat('Moonset',p.moonset)].filter(Boolean);
  const face=moonFace(p);
  if(sky.length||face)blocks.push(el('div',{class:'more-block sky-block'},el('h4',{},'Sun & moon'),
    el('div',{class:'sky-row'},face,sky.length?el('dl',{class:'sky-stats'},sky):null)));
  moreGrid.replaceChildren(...blocks);
  more.hidden=!blocks.length;
}

function showPosterFallback(message){
  updated.textContent=message;
  grid.replaceChildren();offshore.hidden=true;more.hidden=true;
  // Prefer the much smaller WebP copy made at deploy time; fall back to the PNG.
  const stamp='?refresh='+Date.now();
  fallbackImg.onerror=()=>{
    if(fallbackImg.src.includes('.webp')){fallbackImg.src=base+'today.png'+stamp;return;}
    fallback.replaceChildren(el('p',{},'Today’s forecast is not available yet. Use the bank forecasts below.'));
  };
  fallbackImg.src=base+'today.webp'+stamp;
  fallback.hidden=false;
}

(async()=>{
  let manifest;
  try{
    manifest=await M.getJSON(base+'seven-day-manifest.json?refresh='+Date.now());
    if(!Array.isArray(manifest.days)||!manifest.days.length)throw Error('Empty manifest');
  }catch(e){console.warn('Seven-day manifest unavailable:',e);strip.hidden=true;showPosterFallback('Seven-day outlook temporarily unavailable.');return;}

  const days=manifest.days.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d.date)));
  // Load every day so the buttons can show each day's worst rating (older manifests lack worstStatus).
  const loaded=await Promise.all(days.map(d=>M.getJSON(base+'seven-day-'+d.date+'.json?v='+encodeURIComponent(manifest.generatedAt||'')).catch(()=>null)));
  const generated=manifest.generatedAt;
  updated.textContent='Updated '+(M.updatedText(generated)||'time unknown');
  if(M.ageHours(generated)>30){
    stale.textContent='⚠ This outlook is more than a day old. The daily update may have failed — check official advisories before going out.';
    stale.hidden=false;
  }

  try{bankList=(await M.getJSON('banks/banks.json')).filter(b=>b&&b.key&&b.name);}catch{bankList=[];}
  // Three bank pickers above the day buttons.
  const pickBox=el('div',{class:'outlook-picks',role:'group','aria-label':'Choose your banks'});
  const selects=[0,1,2].map(i=>{
    const sel=el('select',{'aria-label':'Bank '+(i+1)},el('option',{value:''},'No bank'),...bankList.map(b=>el('option',{value:b.key},b.name)));
    sel.value=bankList.some(b=>b.key===picks[i])?picks[i]:'';
    sel.addEventListener('change',()=>{picks[i]=sel.value;savePicks();paintButtons();choose(current);});
    pickBox.append(el('label',{},el('span',{},'Bank '+(i+1)),sel));
    return sel;
  });
  picks=selects.map(s=>s.value);
  strip.before(pickBox);

  const buttons=[];let current=0;
  function paintButtons(){
    days.forEach((d,i)=>{
      const p=loaded[i]?.poster;
      const s=p?worstFor(p):null;
      const b=buttons[i];if(!b)return;
      b.className='day-btn '+M.cls(s);
      b.setAttribute('aria-label',M.dayLabel(d.date,{weekday:'long',day:'numeric',month:'long'})+': worst rating of your banks '+M.word(s).toLowerCase()+((d.category==='extended'||i>=3)?', extended outlook':''));
    });
  }
  function choose(i){
    current=i;
    const d=days[i],data=loaded[i];
    buttons.forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));
    if(!data||!data.poster){
      grid.replaceChildren(el('p',{class:'area-missing'},'The forecast for '+M.dayLabel(d.date,{weekday:'long',day:'numeric',month:'short'})+' could not be loaded.'));
      offshore.hidden=true;more.hidden=true;return;
    }
    render(data);
    const extended=d.category==='extended'||i>=3;
    foot.replaceChildren(
      el('strong',{},M.dayLabel(d.date,{weekday:'long',day:'numeric',month:'long'})),
      ' · 07:00–17:00 Jamaica time · ',extended?el('span',{class:'extended-tag'},'Extended outlook — greater uncertainty'):'Short-range forecast',
      ' · ',el('a',{href:base+'seven-day-'+d.date+'.png',target:'_blank',rel:'noopener'},'Share image ↗'));
  }
  days.forEach((d,i)=>{
    const b=el('button',{type:'button',class:'day-btn','aria-pressed':'false'},
      el('span',{class:'day-name'},M.dayLabel(d.date,{weekday:'short'})),
      el('span',{class:'day-num'},M.dayLabel(d.date,{day:'numeric'})),
      el('span',{class:'day-dot','aria-hidden':'true'}));
    b.addEventListener('click',()=>choose(i));
    buttons.push(b);
  });
  strip.replaceChildren(...buttons);
  paintButtons();
  const today=M.jaDate();
  const idx=days.findIndex(d=>d.date>=today);
  choose(idx<0?0:idx);
})();
})();
