/* Marine Weather Jamaica: 7-day outlook as readable text.
   Reads the published seven-day manifest and per-day JSON (the same data the posters are drawn from).
   Day buttons and the headline use the WORST rating of inshore + offshore banks, so a green
   Kingston rating can never hide an offshore alert. */
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

// "11.1 kt (Gust 13.7 kt)" -> main "11.1 kt", sub "gusts 13.7 kt" so values don't wrap on phones.
function splitStat(label,raw,prefix,subPattern,subLabel){
  let text=String(raw||'').trim();if(prefix)text=text.replace(prefix,'');
  const m=text.match(subPattern);
  if(!m)return stat(label,text);
  return stat(label,text.replace(subPattern,'').trim(),subLabel+m[1].replace(/\s+%/,'%').trim());
}

// Current, sea temperature and swell for one area; prefix '' = inshore, 'bank1' / 'bank2' = offshore.
function seaStats(p,prefix){
  const k=f=>prefix+f;
  const cur=p[k('current')],dir=p[k('currentDir')];
  return [stat('Surface current',ok(cur)?cur+(ok(dir)?' '+dir:''):''),stat('Sea temperature',p[k('sst')]),stat('Swell',p[k('swell')])];
}

function areaCard({title,where,status,comfort,reason,stats,highlight}){
  return el('article',{class:'area-card '+M.cls(status)+(highlight?' highlight':'')},
    el('header',{},
      el('div',{},el('p',{class:'area-where'},where),el('h3',{},title)),
      M.pill(status,ok(comfort)?'Comfort '+comfort:null)),
    ok(reason)?el('p',{class:'area-reason'},'Why: '+reason):null,
    el('dl',{class:'area-stats'},stats.filter(Boolean)));
}

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
  const inshore=M.status(p.status);
  const banks=[1,2].map(n=>({n,name:p['bank'+n],status:M.status(p['bank'+n+'status'])})).filter(b=>ok(b.name));
  const offWorst=M.worst(banks.map(b=>b.status));

  // Offshore warning banner when any bank is rated worse than the inshore headline.
  const rank={GREEN:1,AMBER:2,RED:3};
  if(offWorst&&(!inshore||rank[offWorst]>rank[inshore])){
    const names=banks.filter(b=>b.status===offWorst).map(b=>short(b.name));
    const reasons=[...new Set(banks.filter(b=>b.status===offWorst).map(b=>p['bank'+b.n+'reason']).filter(ok))];
    offshore.className='outlook-banner '+M.cls(offWorst);
    offshore.replaceChildren(el('strong',{},'⚠ Offshore '+M.word(offWorst).toLowerCase()+': '),names.join(' & '),
      reasons.length?' — '+reasons.join('; '):'',
      el('span',{class:'banner-sub'},'Inshore Kingston / Maiden Cay is rated '+M.word(inshore).toLowerCase()+'. Check your bank before heading out.'));
    offshore.hidden=false;
  }else offshore.hidden=true;

  const cards=[areaCard({
    title:'Kingston / Maiden Cay',where:'Inshore',status:inshore,comfort:p.comfort,reason:inshore!=='GREEN'?p.overallReason:'',
    stats:[stat('Wind',p.wind,ok(p.gust)?'gusts '+p.gust:''),stat('Seas',p.seas,ok(p.period)?'period '+p.period:''),stat('Rain',p.rain),stat('UV index',p.uv),...seaStats(p,'')]
  })];
  for(const b of banks){
    const k='bank'+b.n;
    cards.push(areaCard({
      title:short(b.name),where:'Offshore bank',status:b.status,comfort:p[k+'comfort'],reason:b.status!=='GREEN'?p[k+'reason']:'',
      highlight:b.status&&b.status===offWorst&&offWorst!=='GREEN',
      stats:[splitStat('Wind',p[k+'windLine'],/^Wind\s*/i,/\s*\(Gust\s*([^)]+)\)/i,'gusts '),splitStat('Seas',p[k+'seaLine'],/^Seas\s*/i,/\s*·\s*Period\s*(.+)$/i,'period '),splitStat('Rain',p[k+'rain'],null,/\s*·\s*(peak chance.*)$/i,''),...seaStats(p,k)]
    }));
  }
  grid.replaceChildren(...cards);

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

  const buttons=[];
  function choose(i){
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
    const p=loaded[i]?.poster;
    const s=p?M.worst(p.status,p.bank1status,p.bank2status):M.status(d.worstStatus||d.status);
    const b=el('button',{type:'button',class:'day-btn '+M.cls(s),'aria-pressed':'false',
      'aria-label':M.dayLabel(d.date,{weekday:'long',day:'numeric',month:'long'})+': worst rating '+M.word(s).toLowerCase()+((d.category==='extended'||i>=3)?', extended outlook':'')},
      el('span',{class:'day-name'},M.dayLabel(d.date,{weekday:'short'})),
      el('span',{class:'day-num'},M.dayLabel(d.date,{day:'numeric'})),
      el('span',{class:'day-dot','aria-hidden':'true'}));
    b.addEventListener('click',()=>choose(i));
    buttons.push(b);
  });
  strip.replaceChildren(...buttons);
  const today=M.jaDate();
  const idx=days.findIndex(d=>d.date>=today);
  choose(idx<0?0:idx);
})();
})();
