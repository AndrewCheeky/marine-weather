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

const ok=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&!/^(—|-|n\/a|not available|unavailable|none identified)$/i.test(String(v).trim());
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
// "02:57", "6:08 AM", "5:33 PM" -> decimal hours, or null.
function hours(v){
  const m=String(v||'').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);if(!m)return null;
  let h=Number(m[1]);const min=Number(m[2]),ap=(m[3]||'').toUpperCase();
  if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;
  return h+min/60;
}
const hhmm=t=>{const mins=((Math.round(t*60)%1440)+1440)%1440;return String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');};
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
function moonBlock(p,date){
  const rise=hours(p.moonrise),set=hours(p.moonset),sunrise=hours(p.sunrise),sunset=hours(p.sunset);
  if(!ok(p.moonPhase))return null;
  const illum=parseFloat(p.moonIllum);
  const tooThin=Number.isFinite(illum)&&illum<3;
  // Moon passes overlapping this calendar day (each pass: rise -> set, can cross midnight).
  let passes=[];
  if(rise!==null&&set!==null){
    if(set>rise)passes=[[rise,set]];
    else{const len=set+24-rise;passes=[[set-len,set],[rise,rise+len]];}
  }
  const night=sunrise!==null&&sunset!==null?[[0,sunrise],[sunset,24]]:[];
  const windows=[];
  for(const [a,b] of passes)for(const [n1,n2] of night){
    const s=Math.max(a,n1,0),e=Math.min(b,n2,24);
    if(e-s>=0.25)windows.push({s,e,a,b});
  }
  const best=windows.sort((x,y)=>(y.e-y.s)-(x.e-x.s))[0];
  const where=w=>{const mid=(w.s+w.e)/2,fr=(mid-w.a)/(w.b-w.a);return fr<0.35?'low in the eastern sky':fr>0.65?'in the western sky':'high in the southern sky';};
  let summary;
  if(tooThin)summary='Too close to the sun to see — a dark night with almost no moonlight.';
  else if(best){
    // A window cut off at midnight continues until the moon sets (or dawn) after midnight.
    const end=best.e>=24&&best.b>24?Math.min(best.b-24,sunrise??24):best.e;
    summary=best.e>=24&&best.b>24
      ? `Best seen from ${hhmm(best.s)} after sunset until ${hhmm(end)} after midnight, ${where(best)}.`
      : `Best seen ${hhmm(best.s)}–${hhmm(end)}, ${where(best)}${best.e<=12?' before dawn':' after sunset'}.`;
  }
  else if(passes.length)summary='Up mainly in daylight today, so hard to spot.';
  else summary='Rise and set times are not available for this day.';
  const nightLight=tooThin?'':(illum>=60?' Bright moonlight at night.':illum>=25?' Some moonlight at night.':' Little moonlight at night.');

  // Sky chart: 24 hours across, night shaded, the moon's path as an arc rising in the east and setting in the west.
  const W=600,H=150,base=112,peak=82,X=t=>t/24*W;
  const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,class:'sky-chart',role:'img','aria-label':summary});
  const defs=svgEl('defs');const clip=svgEl('clipPath',{id:'skyClip-'+date});clip.append(svgEl('rect',{x:0,y:0,width:W,height:base}));defs.append(clip);svg.append(defs);
  svg.append(svgEl('rect',{x:0,y:0,width:W,height:base,fill:'#cfe8f3',rx:8}));
  for(const [n1,n2] of night)svg.append(svgEl('rect',{x:X(n1),y:0,width:X(n2)-X(n1),height:base,fill:'#0c2436'}));
  // Stars at night.
  for(const [t,y] of [[1,20],[2.6,48],[4.2,14],[19.2,30],[21,12],[22.5,52],[23.4,24],[20.2,64]])
    if(night.some(([a,b])=>t>a&&t<b))svg.append(svgEl('circle',{cx:X(t),cy:y,r:1.4,fill:'#fff',opacity:'.7'}));
  const layer=svgEl('g',{'clip-path':`url(#skyClip-${date})`});svg.append(layer);
  const arcPath=(a,b,from=a,to=b)=>{let d='';for(let i=0;i<=40;i++){const t=from+(to-from)*i/40,y=base-Math.sin(Math.PI*(t-a)/(b-a))*peak;d+=(i?'L':'M')+X(t).toFixed(1)+' '+y.toFixed(1);}return d;};
  for(const [a,b] of passes){
    layer.append(svgEl('path',{d:arcPath(a,b),fill:'none',stroke:'#7d97a8','stroke-width':2,'stroke-dasharray':'4 5'}));
    if(!tooThin)for(const w of windows.filter(w=>w.a===a))layer.append(svgEl('path',{d:arcPath(a,b,w.s,w.e),fill:'none',stroke:'#ffd846','stroke-width':4,'stroke-linecap':'round'}));
  }
  // Moon icon: at the current position if it's up now (today), otherwise in the middle of the best viewing window.
  const now=date===M.jaDate()?(()=>{const d=new Date();const s=new Intl.DateTimeFormat('en-US',{timeZone:'America/Jamaica',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d).split(':');return Number(s[0])+Number(s[1])/60;})():null;
  const upNow=now!==null&&passes.find(([a,b])=>now>a&&now<b);
  const iconAt=upNow?{t:now,a:upNow[0],b:upNow[1]}:best&&!tooThin?{t:(best.s+best.e)/2,a:best.a,b:best.b}:null;
  if(iconAt){
    const y=base-Math.sin(Math.PI*(iconAt.t-iconAt.a)/(iconAt.b-iconAt.a))*peak;
    const icon=moonDisc(p.moonPhase,p.moonIllum,26);icon.setAttribute('x',X(iconAt.t)-13);icon.setAttribute('y',y-13);icon.removeAttribute('role');
    svg.append(icon);
    if(upNow)svg.append(svgEl('text',{x:Math.min(W-30,Math.max(30,X(now))),y:Math.max(12,y-18),class:'sky-now','text-anchor':'middle'},'Now'));
  }
  svg.append(svgEl('line',{x1:0,x2:W,y1:base,y2:base,stroke:'#5b7486','stroke-width':1.5}));
  for(const t of [0,6,12,18,24])svg.append(svgEl('text',{x:Math.min(W-4,Math.max(4,X(t))),y:H-20,class:'sky-axis','text-anchor':t===0?'start':t===24?'end':'middle'},t===24?'24:00':String(t).padStart(2,'0')+':00'));
  // Labels sit under the rise/set points but are kept fully inside the chart.
  const LBL=120;
  if(rise!==null)svg.append(svgEl('text',{x:Math.min(W-LBL,Math.max(2,X(rise)-6)),y:H-4,class:'sky-label','text-anchor':'start'},'↑ rises '+hhmm(rise)+' (E)'));
  if(set!==null)svg.append(svgEl('text',{x:Math.max(LBL,Math.min(W-2,X(set)+6)),y:H-4,class:'sky-label','text-anchor':'end'},'sets '+hhmm(set)+' (W) ↓'));

  return el('div',{class:'moon-view'},
    el('div',{class:'moon-face'},moonDisc(p.moonPhase,p.moonIllum),
      el('p',{},el('strong',{},p.moonPhase),ok(p.moonIllum)?el('span',{},p.moonIllum+' lit'):null)),
    el('div',{class:'moon-sky'},
      el('p',{class:'moon-summary'},summary+nightLight),
      svg,
      el('p',{class:'fine'},'Yellow = moon up in a dark sky (visible). Dashed = moon up in daylight. Shape shown as seen from Jamaica: a waxing moon is lit on the right, a waning moon on the left.')));
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
    stats:[stat('Wind',p.wind,ok(p.gust)?'gusts '+p.gust:''),stat('Seas',p.seas,ok(p.period)?'period '+p.period:''),stat('Rain',p.rain),stat('UV index',p.uv)]
  })];
  for(const b of banks){
    const k='bank'+b.n;
    cards.push(areaCard({
      title:short(b.name),where:'Offshore bank',status:b.status,comfort:p[k+'comfort'],reason:b.status!=='GREEN'?p[k+'reason']:'',
      highlight:b.status&&b.status===offWorst&&offWorst!=='GREEN',
      stats:[splitStat('Wind',p[k+'windLine'],/^Wind\s*/i,/\s*\(Gust\s*([^)]+)\)/i,'gusts '),splitStat('Seas',p[k+'seaLine'],/^Seas\s*/i,/\s*·\s*Period\s*(.+)$/i,'period '),splitStat('Rain',p[k+'rain'],null,/\s*·\s*(peak chance.*)$/i,'')]
    }));
  }
  grid.replaceChildren(...cards);

  // Secondary details live behind a disclosure so the headline stays short on phones.
  const blocks=[];
  const tides=[stat('High tide',p.highTides),stat('Low tide',p.lowTides)].filter(Boolean);
  if(tides.length)blocks.push(el('div',{class:'more-block'},el('h4',{},'Tides · Kingston (model)'),el('dl',{},tides)));
  const sky=[stat('Sunrise',p.sunrise),stat('Sunset',p.sunset),stat('Moon',p.moonPhase,ok(p.moonIllum)?p.moonIllum+' lit':''),stat('Moonrise / set',ok(p.moonrise)||ok(p.moonset)?(p.moonrise||'—')+' / '+(p.moonset||'—'):'')].filter(Boolean);
  const moonView=moonBlock(p,day.date);
  if(sky.length||moonView)blocks.push(el('div',{class:'more-block wide sky-block'},el('h4',{},'Sun & moon'),moonView,sky.length?el('dl',{class:'sky-stats'},sky):null));
  const sea=[stat('Surface current',ok(p.current)?p.current+(ok(p.currentDir)?' '+p.currentDir:''):''),stat('Sea temperature',p.sst),stat('Swell',p.swell)].filter(Boolean);
  if(sea.length)blocks.push(el('div',{class:'more-block'},el('h4',{},'Other conditions'),el('dl',{},sea)));
  const windows=(Array.isArray(p.travelWindows)?p.travelWindows:[]).filter(w=>ok(w.destination));
  if(windows.length)blocks.push(el('div',{class:'more-block wide'},el('h4',{},'Weather windows (07:00–17:00)'),
    el('ul',{class:'windows'},windows.map(w=>el('li',{},el('strong',{},w.destination+': '),
      ok(w.departure)?'out '+w.departure+(ok(w.return)?', back '+w.return:''):'no suitable two-hour window found',
      M.num(w.maxGustKn)!==null?' · peak gust '+M.fmt(w.maxGustKn)+' kt'+(ok(w.maxGustTime)?' at '+w.maxGustTime:''):''))),
    el('p',{class:'fine'},'Weather windows are guidance only, not route or vessel clearance.')));
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
