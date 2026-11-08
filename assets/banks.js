/* Marine Weather Jamaica: fishing bank forecasts as readable text, charts and a map.
   Data: banks/banks.json (list), banks/locations.json (optional coordinates, published from the
   Google Sheet), banks/hourly/<key>-24h.json (hourly rows) and banks/hourly/<key>-<window>.json
   (server ratings per hour). Nothing here calls a weather provider directly. */
(()=>{'use strict';
const M=window.MW;if(!M)return;
const {el,fmt,num}=M;
const ENDPOINT='https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const $=id=>document.getElementById(id);
const bankSel=$('bank-select'),period=$('bank-period'),live=$('bank-live');
const title=$('bank-title'),updatedEl=$('bank-updated'),state=$('bank-state');
const setRating=node=>{node.id='bank-rating';$('bank-rating').replaceWith(node);};
const statsEl=$('bank-stats'),charts=$('bank-charts'),hoursBox=$('bank-hours'),rowsEl=$('bank-rows');
const quick=$('bank-quicklook'),quickImg=$('bank-image'),quickLink=$('bank-image-link');
if(!bankSel)return;

let banks=[];
const safeKey=s=>/^[a-z0-9_-]+$/.test(s);
const nameOf=key=>banks.find(b=>b.key===key)?.name||key;
const hh=stamp=>String(stamp).slice(11,16);

/* ---------- data ---------- */
async function hourlyRows(key,when){
  const today=M.jaDate(),tomorrow=M.jaDate(1);
  try{
    const data=await M.getJSON(`banks/hourly/${key}-24h.json?t=${Date.now()}`);
    if(data.key!==key||!Array.isArray(data.hours))throw Error('bad 24h file');
    const start=when==='tomorrow'?tomorrow+'T07:00':today+'T'+String(M.jaHour()).padStart(2,'0')+':00';
    const end=when==='tomorrow'?tomorrow+'T17:00':null;
    const rows=data.hours.filter(r=>r.metrics&&r.stamp>=start&&(!end||r.stamp<=end))
      .sort((a,b)=>a.stamp.localeCompare(b.stamp)).slice(0,when==='tomorrow'?11:24)
      .map(r=>({stamp:r.stamp,...r.metrics}));
    if(rows.length)return {rows,updated:data.generated_at};
  }catch(e){console.warn('24-hour file unavailable for',key,e.message);}
  // Fallback: the shorter window file written with the quick-look images.
  const data=await M.getJSON(`banks/hourly/${key}-${when}.json?t=${Date.now()}`);
  if(data.day!==(when==='tomorrow'?tomorrow:today))throw Error('No hourly forecast published for this window yet.');
  return {rows:data.hours.map(r=>({stamp:data.day+'T'+r.time,...r})),updated:data.published_at,partial:true};
}

// Rating for the day: the full 07:00–17:00 score (with its reason) that the 7-day outlook shows,
// so the bank card and the outlook always agree and every bank is rated. Falls back to the
// older per-hour rating file if the outlook has no entry for this bank.
const outlookDay={};
async function outlookArea(key,day){
  if(!(day in outlookDay))outlookDay[day]=M.getJSON(`instagram/generated/seven-day-${day}.json?t=${Date.now()}`).catch(()=>null);
  const data=await outlookDay[day];
  const areas=data&&data.poster&&Array.isArray(data.poster.areas)?data.poster.areas:[];
  return areas.find(a=>a&&a.key===key)||null;
}
async function bankRating(key,when){
  const day=when==='tomorrow'?M.jaDate(1):M.jaDate();
  const label=(when==='tomorrow'?'tomorrow':'today')+' 07–17';
  try{
    const a=await outlookArea(key,day);
    if(a&&M.status(a.status)){
      const why=M.status(a.status)!=='GREEN'&&a.reason?String(a.reason).split(/\s*[·;]\s*/).filter(x=>x&&!/^Comfort\s/i.test(x)&&!/^Rated by the forecast service/i.test(x)&&!/within GOOD limits/i.test(x)).slice(0,2).join(' · '):'';
      return {status:a.status,note:label+(why?' · '+why:'')};
    }
  }catch{}
  try{
    const data=await M.getJSON(`banks/hourly/${key}-${when}.json?t=${Date.now()}`);
    if(data.day!==day)return {status:null,note:'rating out of date'};
    if(when==='current'&&M.ageHours(data.published_at)>8)return {status:null,note:'rating out of date'};
    const s=M.worst((data.hours||[]).map(h=>h.conditionColor));
    return {status:s,note:when==='tomorrow'?'tomorrow 07–17':'next few hours'};
  }catch{return {status:null,note:'no rating published'};}
}

/* ---------- charts (one axis each: never mix knots and feet on one scale) ---------- */
function niceMax(v){const m=Math.max(1,v);const step=m<=4?1:m<=10?2:m<=25?5:10;return Math.ceil(m/step)*step;}
const tip=el('div',{class:'chart-tip',role:'status'});tip.hidden=true;document.body.append(tip);

function drawChart(fig,{heading,unit,labels,series,bars}){
  const W=640,H=190,L=34,R=10,T=14,B=26,iw=W-L-R,ih=H-T-B,n=labels.length;
  const all=series.flatMap(s=>s.values).filter(v=>v!==null);
  const max=niceMax(all.length?Math.max(...all):1);
  const x=i=>L+(n<=1?iw/2:bars?(i+0.5)*iw/n:i*iw/(n-1));
  const y=v=>T+ih-(v/max)*ih;
  const NS='http://www.w3.org/2000/svg';
  const s=(tag,a={},text)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(a))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;};
  const svg=s('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`${heading} by hour; maximum ${fmt(Math.max(...all))} ${unit}. Full values in the hour-by-hour table.`});
  const step=max<=4?1:max<=10?2:max<=25?5:10;
  for(let v=0;v<=max+1e-9;v+=step){
    const yy=y(v);
    svg.append(s('line',{x1:L,x2:W-R,y1:yy,y2:yy,class:'grid'}));
    svg.append(s('text',{x:L-6,y:yy+4,class:'axis','text-anchor':'end'},String(Math.round(v*10)/10)));
  }
  const every=n>16?3:n>8?2:1;
  labels.forEach((lab,i)=>{if(i%every===0)svg.append(s('text',{x:x(i),y:H-8,class:'axis','text-anchor':'middle'},hh(lab).replace(':00','')+'h'));});
  for(const ser of series){
    if(bars){
      const bw=Math.max(4,iw/n-4);
      ser.values.forEach((v,i)=>{if(v===null)return;const top=y(v),h=Math.max(1,T+ih-top);
        svg.append(s('path',{d:`M${x(i)-bw/2} ${T+ih}V${top+Math.min(4,h)}q0-4 4-4h${bw-8}q4 0 4 4V${T+ih}Z`,fill:ser.color,class:'bar'}));});
    }else{
      const pts=ser.values.map((v,i)=>v===null?null:[x(i),y(v)]);
      let d='';pts.forEach((p,i)=>{if(!p)return;d+=(d&&pts[i-1]?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);});
      svg.append(s('path',{d,fill:'none',stroke:ser.color,'stroke-width':2,'stroke-dasharray':ser.dash||'none','stroke-linecap':'round','stroke-linejoin':'round'}));
      // Direct label at the last point.
      const last=[...pts].reverse().find(Boolean);
      if(last&&series.length>1)svg.append(s('text',{x:Math.min(last[0]+4,W-R-2),y:last[1]-6,class:'direct','text-anchor':'end',fill:'currentColor'},ser.name));
    }
  }
  // Hover / tap layer: a crosshair and tooltip per hour.
  const cross=s('line',{x1:0,x2:0,y1:T,y2:T+ih,class:'cross',visibility:'hidden'});svg.append(cross);
  const hit=s('rect',{x:L,y:T,width:iw,height:ih,fill:'transparent'});svg.append(hit);
  const show=ev=>{
    const r=svg.getBoundingClientRect();const px=(ev.clientX-r.left)/r.width*W;
    let i=bars?Math.floor((px-L)/(iw/n)):Math.round((px-L)/(iw/Math.max(1,n-1)));i=Math.max(0,Math.min(n-1,i));
    cross.setAttribute('x1',x(i));cross.setAttribute('x2',x(i));cross.setAttribute('visibility','visible');
    tip.replaceChildren(el('strong',{},labels[i].replace('T',' ')),...series.map(ser=>el('div',{},el('span',{class:'swatch',style:`background:${ser.color}`}),`${ser.name}: ${fmt(ser.values[i])} ${unit}`)));
    tip.hidden=false;
    const tx=Math.min(window.innerWidth-tip.offsetWidth-8,Math.max(8,ev.clientX+12));
    tip.style.left=tx+'px';tip.style.top=(ev.clientY+window.scrollY-tip.offsetHeight-12)+'px';
  };
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerdown',show);
  hit.addEventListener('pointerleave',()=>{tip.hidden=true;cross.setAttribute('visibility','hidden');});
  const legend=series.length>1?el('ul',{class:'chart-legend'},series.map(ser=>el('li',{},el('span',{class:'swatch'+(ser.dash?' dashed':''),style:`--c:${ser.color}`}),ser.name))):null;
  fig.replaceChildren(...[el('figcaption',{},heading+' ',el('span',{},'('+unit+')')),legend,svg].filter(Boolean));
}

/* ---------- render ---------- */
function peak(rows,key){let best=null;for(const r of rows){const v=num(r[key]);if(v!==null&&(!best||v>best.v))best={v,stamp:r.stamp};}return best;}
function stat(label,value,sub){return el('div',{class:'stat'},el('dt',{},label),el('dd',{},value,sub?el('small',{},sub):null));}

let seq=0;
async function update(){
  const key=bankSel.value,when=period.value,id=++seq;
  if(!safeKey(key))return;
  title.textContent=nameOf(key);
  live.href=ENDPOINT+'?action=bank&key='+encodeURIComponent(key)+'&when='+encodeURIComponent(when)+'&popup=1&hideFooter=1';
  state.hidden=false;state.textContent='Loading forecast…';
  quick.open=false;quick.hidden=false;quickImg.removeAttribute('src');
  quickImg.alt=nameOf(key)+' quick-look forecast card';
  quickLink.href=`banks/generated/${key}-${when}.webp`;
  try{
    const [{rows,updated,partial},rate]=await Promise.all([hourlyRows(key,when),bankRating(key,when)]);
    if(id!==seq)return;
    // Bank data refreshes every 6 hours; older than 8 hours means a refresh was missed.
    const old=M.ageHours(updated)>8;
    updatedEl.textContent=(old?'⚠ Not updated since ':'Updated ')+(M.updatedText(updated)||'time unknown')+(partial?' · partial forecast':'')+(old?' · this forecast may be out of date':'');
    updatedEl.classList.toggle('is-stale',old);
    const off=M.withOfficial(key,when==='tomorrow'?M.jaDate(1):M.jaDate(),rate.status,'');
    setRating(M.pill(off.status,off.reason?off.reason+' · '+rate.note.split(' · ')[0]:rate.note));
    const w=peak(rows,'avgWindKn'),g=peak(rows,'peakGustKn'),s=peak(rows,'avgWaveM'),c=peak(rows,'avgCurrentKn'),r=peak(rows,'rainProbabilityPct');
    const atSeas=s?rows.find(x=>x.stamp===s.stamp):null;
    statsEl.replaceChildren(
      stat('Max wind',w?fmt(w.v)+' kt':'—',w?'at '+hh(w.stamp):''),
      stat('Max gust',g?fmt(g.v)+' kt':'—',g?'at '+hh(g.stamp):''),
      stat('Max seas',s?fmt(s.v*M.M_TO_FT)+' ft':'—',[atSeas&&num(atSeas.avgWavePeriodS)!==null?'period '+fmt(atSeas.avgWavePeriodS)+' s':'',s?M.biggestWaves(s.v*M.M_TO_FT):''].filter(Boolean).join(' · ')),
      stat('Max current',c?fmt(c.v)+' kt':'—',''),
      stat('Peak rain chance',r?Math.round(r.v)+'%':'—',r?'at '+hh(r.stamp):''));
    statsEl.hidden=false;
    const labels=rows.map(x=>x.stamp);
    drawChart($('chart-wind'),{heading:'Wind and gusts',unit:'kt',labels,series:[
      {name:'Wind',color:'#0877a8',values:rows.map(x=>num(x.avgWindKn))},
      {name:'Gusts',color:'#c2410c',dash:'5 4',values:rows.map(x=>num(x.peakGustKn))}]});
    drawChart($('chart-seas'),{heading:'Seas',unit:'ft',labels,bars:true,series:[
      {name:'Seas',color:'#0877a8',values:rows.map(x=>{const v=num(x.avgWaveM);return v===null?null:v*M.M_TO_FT;})}]});
    charts.hidden=false;
    rowsEl.replaceChildren(...rows.map(x=>{
      const dir=M.compass(x.windDirMeanDeg);
      return el('tr',{},el('th',{scope:'row'},x.stamp.slice(5,10).replace('-','/')+' '+hh(x.stamp)),
        el('td',{},fmt(x.avgWindKn)+(dir?' '+dir:'')),el('td',{},fmt(x.peakGustKn)),
        el('td',{},num(x.avgWaveM)===null?'—':fmt(x.avgWaveM*M.M_TO_FT)),el('td',{},fmt(x.avgWavePeriodS)),
        el('td',{},fmt(x.avgCurrentKn)),el('td',{},num(x.rainProbabilityPct)===null?'—':Math.round(x.rainProbabilityPct)));
    }));
    hoursBox.hidden=false;
    state.hidden=true;
  }catch(e){
    if(id!==seq)return;
    statsEl.hidden=true;charts.hidden=true;hoursBox.hidden=true;
    setRating(M.pill(null));
    // No usable hours usually means the latest update didn't come through.
    updatedEl.textContent='⚠ No up-to-date forecast for this bank right now';updatedEl.classList.add('is-stale');
    state.textContent='The latest update may have failed. Check official marine warnings before going out, or use “Open live forecast”. ('+e.message+')';
  }
  highlightMarker(key);
}
// The quick-look image is only downloaded when someone opens it.
quick.addEventListener('toggle',()=>{
  if(!quick.open||quickImg.getAttribute('src'))return;
  quickImg.onerror=()=>{quickLink.replaceWith(el('p',{class:'fine'},'No quick-look card has been published for this window yet.'));};
  quickImg.src=quickLink.href;
});

/* ---------- map (Leaflet, loaded only when the section scrolls into view) ---------- */
const mapBox=$('bank-map'),mapNote=$('map-note');
let markers=new Map(),map=null;
const COLORS={green:'#17834a',amber:'#f5b942',red:'#c83c45',unknown:'#7a8c99'};
function loadLeaflet(){
  if(window.L)return Promise.resolve(window.L);
  return new Promise((resolve,reject)=>{
    const css=el('link',{rel:'stylesheet',href:'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',integrity:'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',crossorigin:'anonymous'});
    const js=el('script',{src:'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',integrity:'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',crossorigin:'anonymous'});
    js.onload=()=>resolve(window.L);js.onerror=()=>reject(Error('Map library unavailable'));
    document.head.append(css,js);
  });
}
async function buildMap(){
  const placed=banks.filter(b=>num(b.lat)!==null&&num(b.lon)!==null);
  if(!placed.length){mapBox.replaceChildren(el('p',{class:'map-placeholder'},'Bank locations have not been published yet.'));return;}
  try{
    const L=await loadLeaflet();
    mapBox.replaceChildren();
    map=L.map(mapBox,{scrollWheelZoom:false,attributionControl:true}).setView([18.0,-77.2],7);
    // GEBCO depth map (free, no key): sea coloured by depth so the banks stand out from deep water.
    // If GEBCO's server can't be reached, keep the bank dots and say so (no backup map).
    const GEBCO_CREDIT='Imagery reproduced from the <a href="https://www.gebco.net/" target="_blank" rel="noopener">GEBCO_2026 Grid</a>, GEBCO Compilation Group (2026)';
    const gebco=L.tileLayer.wms('https://wms.gebco.net/mapserv?',{
      layers:'gebco_latest_2',format:'image/png',transparent:false,version:'1.1.1',maxZoom:11,attribution:GEBCO_CREDIT
    });
    let gebcoErrors=0,gebcoLoaded=0;
    gebco.on('tileload',()=>{gebcoLoaded++;});
    gebco.on('tileerror',()=>{
      if(++gebcoErrors===4&&gebcoLoaded===0){
        mapNote.textContent=('Depth map unavailable right now; the bank dots still work. '+(mapNote.hidden?'':mapNote.textContent)).trim();mapNote.hidden=false;}
    });
    gebco.addTo(map);
    const ratings=await Promise.all(placed.map(b=>bankRating(b.key,'current')));
    placed.forEach((b,i)=>{
      const c=M.cls(ratings[i].status);
      const m=L.circleMarker([b.lat,b.lon],{radius:9,weight:2,color:'#ffffff',fillColor:COLORS[c],fillOpacity:1})
        .addTo(map).bindTooltip(`${b.name}: ${M.word(ratings[i].status)}`,{direction:'top'});
      m.on('click',()=>{bankSel.value=b.key;update();$('bank-card').scrollIntoView({behavior:'smooth',block:'start'});});
      markers.set(b.key,m);
    });
    map.fitBounds(L.latLngBounds(placed.map(b=>[b.lat,b.lon])).pad(0.35),{maxZoom:9});
    highlightMarker(bankSel.value);
  }catch(e){mapBox.replaceChildren(el('p',{class:'map-placeholder'},'The map could not load. Use the list above.'));}
  const missing=banks.length-placed.length;
  if(missing>0){mapNote.textContent=`${missing} of ${banks.length} locations are not on the map yet (no coordinates published). Pick them from the list.`;mapNote.hidden=false;}
}
function highlightMarker(key){
  for(const [k,m] of markers)m.setStyle({weight:k===key?4:2,color:k===key?'#052638':'#ffffff',radius:k===key?12:9});
}

/* ---------- start ---------- */
(async()=>{
  try{
    const list=await M.getJSON('banks/banks.json');
    let coords={};
    try{const loc=await M.getJSON('banks/locations.json?t='+Date.now());for(const l of (Array.isArray(loc)?loc:loc.banks||[]))coords[l.key]=l;}catch{}
    banks=list.filter(x=>safeKey(x.key)&&x.name).map(b=>({...b,lat:num(coords[b.key]?.lat??b.lat),lon:num(coords[b.key]?.lon??b.lon)}));
    bankSel.replaceChildren(...banks.map(b=>el('option',{value:b.key},b.name)));
    const fromHash=new URLSearchParams(location.hash.split('?')[1]||'').get('bank');
    bankSel.value=banks.some(b=>b.key===fromHash)?fromHash:banks[0]?.key||'';
    update();
    const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){io.disconnect();buildMap();}},{rootMargin:'200px'});
    io.observe(mapBox);
  }catch{state.textContent='Fishing locations could not be loaded. Please refresh the page.';}
})();
bankSel.addEventListener('change',update);period.addEventListener('change',update);
window.addEventListener('mw:smallcraft',()=>{if(bankSel.value)update();});

/* ---------- live forecast pop-up (unchanged behaviour) ---------- */
const modal=$('live-forecast-modal'),frame=$('live-forecast-frame'),loading=$('live-forecast-loading'),close=$('live-forecast-close'),modalTitle=$('live-forecast-title');
let loadTimer=null,previousFocus=null,openSeq=0;
function hideLoading(){if(loadTimer){clearTimeout(loadTimer);loadTimer=null;}loading.hidden=true;}
function closeLive(){openSeq++;hideLoading();modal.hidden=true;frame.removeAttribute('src');document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus();}
if(modal&&frame&&loading&&close){
  live.addEventListener('click',event=>{
    if(!live.href)return;event.preventDefault();
    previousFocus=document.activeElement;modalTitle.textContent=(title.textContent||'Fishing bank')+' — Live forecast';
    modal.hidden=false;loading.hidden=false;document.body.style.overflow='hidden';close.focus();
    const s=++openSeq;let started=false;
    frame.onload=()=>{if(s===openSeq&&started)hideLoading();};
    loading.querySelector('strong').textContent='Loading live forecast…';
    loading.querySelector('span:last-child').textContent='Please wait while your marine outlook opens.';
    loadTimer=setTimeout(()=>{if(s===openSeq&&!loading.hidden){
      loading.querySelector('strong').textContent='Still loading live forecast…';
      loading.querySelector('span:last-child').textContent='The forecast is taking longer than usual; please wait.';}},15000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(s!==openSeq)return;started=true;frame.src=live.href;}));
  });
  close.addEventListener('click',closeLive);
  modal.addEventListener('click',e=>{if(e.target===modal)closeLive();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)closeLive();});
}
})();
