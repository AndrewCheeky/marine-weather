(()=>{'use strict';
const ENDPOINT='https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const bank=document.getElementById('bank-select'),period=document.getElementById('bank-period'),img=document.getElementById('bank-image'),link=document.getElementById('bank-image-link'),live=document.getElementById('bank-live'),state=document.getElementById('bank-image-state'),title=document.getElementById('bank-title');
if(!bank)return;
let banks=[];
const dialog=document.getElementById('bank-hourly-dialog'),hourlyClose=document.getElementById('bank-hourly-close'),expanded=document.getElementById('bank-hourly-image'),heading=document.getElementById('bank-hourly-heading'),meta=document.getElementById('bank-hourly-meta'),rows=document.getElementById('bank-hourly-rows');
const fmt=(v,unit='')=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(1)+unit;
// Fetch the existing published forecast snapshot when the visitor opens the popup.
// This is a cache read, not a direct weather-provider request.
const hourlyCache=new Map(),HOURLY_TTL=10*60*1000;
const jmDay=(offset=0)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*86400000));
const jmHour=()=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Jamaica',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
function requestJSONP(url){
  return new Promise((resolve,reject)=>{
    const callback='mwHourly_'+Math.random().toString(36).slice(2);
    const script=document.createElement('script');
    let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);delete window[callback];script.remove();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('Live hourly request timed out')),12000);
    window[callback]=value=>finish(null,value);
    script.onerror=()=>finish(new Error('Live hourly endpoint unavailable'));
    url.searchParams.set('callback',callback);
    url.searchParams.set('_',String(Date.now()));
    script.src=url.toString();document.head.appendChild(script);
  });
}
async function fetchSnapshot(key,day){
  const url=new URL(ENDPOINT);
  url.searchParams.set('action','snapshot');
  url.searchParams.set('key',key);
  url.searchParams.set('day',day);
  const cacheKey=key+'|'+day,stored=hourlyCache.get(cacheKey);
  if(stored&&Date.now()-stored.time<HOURLY_TTL)return stored.data;
  // Google Apps Script redirects can prevent cross-origin fetch; support JSONP
  // when the deployed Apps Script handler exposes the callback parameter.
  let data;
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url.toString(),{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw Error('Live snapshot unavailable');
      data=await response.json();
    }finally{clearTimeout(timer);}
  }catch(_error){data=await requestJSONP(url);}
  if(!data||!Array.isArray(data.hours)||!data.version)throw Error('Invalid live hourly snapshot');
  hourlyCache.set(cacheKey,{time:Date.now(),data});
  return data;
}
function hourlyWindow(snapshots,when){
  const all=new Map();
  for(const snapshot of snapshots)for(const row of snapshot.hours||[]){
    if(!row||!row.metrics||!row.day||row.hour==null)continue;
    const hour=Number(row.hour);
    if(!Number.isInteger(hour)||hour<0||hour>23)continue;
    const stamp=row.day+'T'+String(hour).padStart(2,'0');
    all.set(stamp,{...row,stamp});
  }
  const today=jmDay(),tomorrow=jmDay(1);
  const start=when==='tomorrow'?tomorrow+'T07':today+'T'+String(jmHour()).padStart(2,'0');
  const end=when==='tomorrow'?tomorrow+'T17':null;
  return [...all.values()].filter(r=>r.stamp>=start&&(!end||r.stamp<=end))
    .sort((a,b)=>a.stamp.localeCompare(b.stamp)).slice(0,when==='tomorrow'?11:12);
}
async function sheetPublishedHours(key,when){
  const response=await fetch(`banks/hourly/${key}-24h.json`,{cache:'no-store'});
  if(!response.ok)throw Error('24-hour published forecast unavailable');
  const data=await response.json();
  if(data.key!==key||!Array.isArray(data.hours))throw Error('Invalid 24-hour published forecast');
  const today=jmDay(),tomorrow=jmDay(1);
  const start=when==='tomorrow'?tomorrow+'T07:00':today+'T'+String(jmHour()).padStart(2,'0')+':00';
  const end=when==='tomorrow'?tomorrow+'T17:00':null;
  const selected=data.hours.filter(r=>r.stamp>=start&&(!end||r.stamp<=end)&&r.metrics)
    .sort((a,b)=>a.stamp.localeCompare(b.stamp));
  if(!selected.length)throw Error('No current sheet-published hourly records');
  return {hours:selected.slice(0,when==='tomorrow'?11:24),updated:data.generated_at,source:'Published 24-hour forecast'};
}
async function liveHours(key,when){
  const today=jmDay(),tomorrow=jmDay(1);
  const days=when==='tomorrow'?[tomorrow]:[today,tomorrow];
  const results=await Promise.allSettled(days.map(day=>fetchSnapshot(key,day)));
  const snapshots=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!snapshots.length)throw Error('Live hourly data unavailable');
  const hours=hourlyWindow(snapshots,when);
  if(!hours.length)throw Error('No hourly records for the requested period');
  return {hours,updated:snapshots.map(s=>s.published_at).filter(Boolean).sort().at(-1),source:'On-demand forecast'};
}
async function publishedHours(key,when){
  const response=await fetch(`banks/hourly/${key}-${when}.json`,{cache:'no-store'});
  if(!response.ok)throw Error('No published hourly snapshot');
  const data=await response.json();
  if(data.key!==key||data.period!==when||!Array.isArray(data.hours)||!data.hours.length)throw Error('Invalid published hourly snapshot');
  if(data.day!==jmDay(when==='tomorrow'?1:0))throw Error('Published forecast is for another day');
  return {hours:data.hours.map(r=>({day:data.day,time:r.time,metrics:r})),updated:data.published_at,source:'Published fallback'};
}
let hourlyOpenId=0;
async function openExpanded(event){
  event.preventDefault();
  const item=banks.find(b=>b.key===bank.value);
  if(!item||!dialog)return;
  const when=period.value,id=++hourlyOpenId;
  expanded.src=img.src;
  heading.textContent=item.name+' — '+(when==='tomorrow'?'Tomorrow 07:00–17:00':'Rolling 24-hour forecast');
  meta.textContent='Loading available hourly forecast…';
  rows.replaceChildren();dialog.showModal();
  let result,notice='';
  try{result=await sheetPublishedHours(item.key,when);}
  catch(_error){
    notice='Full published forecast unavailable; using limited snapshot. ';
    try{result=await liveHours(item.key,when);}
    catch(_fallback){try{result=await publishedHours(item.key,when);}catch(error){if(id===hourlyOpenId&&dialog.open)meta.textContent='Hourly details unavailable: '+error.message;return;}}
  }
  if(id!==hourlyOpenId||!dialog.open||bank.value!==item.key||period.value!==when)return;
  const {hours,updated,source}=result;
  const expected=when==='tomorrow'?11:24;
  meta.textContent=notice+source+' · '+hours.length+' hourly records'+
    (updated?' · Updated '+new Date(updated).toLocaleString('en-JM',{timeZone:'America/Jamaica'}):'')+
    (hours.length<expected?' · Partial forecast — verify current conditions':'');
  for(const h of hours){
    const m=h.metrics||h,tr=document.createElement('tr');
    const time=(h.day?h.day+' ':'')+(h.time||String(h.hour).padStart(2,'0')+':00');
    const values=[time,fmt(m.avgWindKn),fmt(m.peakGustKn),fmt(m.avgWaveM==null?null:Number(m.avgWaveM)*3.28084),fmt(m.avgWavePeriodS),fmt(m.avgCurrentKn),fmt(m.rainProbabilityPct)];
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}
    rows.appendChild(tr);
  }
}
link.addEventListener('click',openExpanded);hourlyClose?.addEventListener('click',()=>dialog.close());dialog?.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});

const safeKey=s=>/^[a-z0-9_-]+$/.test(s);
function update(){const item=banks.find(b=>b.key===bank.value);if(!item)return;title.textContent=item.name;const when=period.value;const src=`banks/generated/${item.key}-${when}.webp`;const liveUrl=ENDPOINT+'?action=bank&key='+encodeURIComponent(item.key)+'&when='+encodeURIComponent(when)+'&popup=1&hideFooter=1';live.href=liveUrl;img.alt=item.name+' '+when+' marine forecast';img.hidden=true;link.hidden=true;state.hidden=false;state.textContent='Checking published forecast image…';const probe=new Image();probe.onload=()=>{img.src=src;link.href=src;link.hidden=false;img.hidden=false;state.hidden=true};probe.onerror=()=>{link.hidden=true;img.hidden=true;state.hidden=false;state.textContent='A cached image has not been published for this location yet. Open the live forecast instead.'};probe.src=src;}
fetch('banks/banks.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('locations');return r.json()}).then(data=>{banks=data.filter(x=>safeKey(x.key)&&x.name);for(const item of banks){const o=document.createElement('option');o.value=item.key;o.textContent=item.name;bank.appendChild(o)}bank.value=banks[0]?.key||'';update()}).catch(()=>{state.textContent='Fishing locations could not be loaded. Use the Fishing Banks tab above.'});bank.addEventListener('change',update);period.addEventListener('change',update);
// Keep the loading dialog visible until the live forecast iframe loads (15-second fallback).
const modal=document.getElementById('live-forecast-modal');
const frame=document.getElementById('live-forecast-frame');
const loading=document.getElementById('live-forecast-loading');
const close=document.getElementById('live-forecast-close');
const modalTitle=document.getElementById('live-forecast-title');
let loadTimer=null,previousFocus=null,openSeq=0;
function hideLoading(){if(loadTimer){clearTimeout(loadTimer);loadTimer=null;}loading.hidden=true;}
function closeLive(){openSeq++;hideLoading();modal.hidden=true;frame.removeAttribute('src');document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus();}
if(modal&&frame&&loading&&close){
  live.addEventListener('click',event=>{
    if(!live.href)return;event.preventDefault();
    previousFocus=document.activeElement;modalTitle.textContent=(title.textContent||'Fishing bank')+' — Live forecast';
    modal.hidden=false;loading.hidden=false;document.body.style.overflow='hidden';close.focus();
    const seq=++openSeq;
    // Ignore the initial about:blank iframe load; it is not the forecast.
    let navigationStarted=false;
    frame.onload=()=>{if(seq===openSeq && navigationStarted)hideLoading();};
    // Keep a visible status if the destination takes too long, rather than flashing blank.
    loadTimer=setTimeout(()=>{if(seq===openSeq && !loading.hidden){
      loading.querySelector('strong').textContent='Still loading live forecast…';
      loading.querySelector('span:last-child').textContent='The forecast is taking longer than usual; please wait.';
    }},15000);
    loading.querySelector('strong').textContent='Loading live forecast…';
    loading.querySelector('span:last-child').textContent='Please wait while your marine outlook opens.';
    // Paint the loading dialog BEFORE navigating the iframe.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(seq!==openSeq)return;
      navigationStarted=true;
      frame.src=live.href;
    }));
  });
  close.addEventListener('click',closeLive);
  modal.addEventListener('click',event=>{if(event.target===modal)closeLive();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)closeLive();});
}

})();
