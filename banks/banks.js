(()=>{'use strict';
const ENDPOINT='https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const bank=document.getElementById('bank-select'),period=document.getElementById('bank-period'),img=document.getElementById('bank-image'),link=document.getElementById('bank-image-link'),live=document.getElementById('bank-live'),state=document.getElementById('bank-image-state'),title=document.getElementById('bank-title');
if(!bank)return;
let banks=[];
const dialog=document.getElementById('bank-hourly-dialog'),hourlyClose=document.getElementById('bank-hourly-close'),expanded=document.getElementById('bank-hourly-image'),heading=document.getElementById('bank-hourly-heading'),meta=document.getElementById('bank-hourly-meta'),rows=document.getElementById('bank-hourly-rows');
const fmt=(v,unit='')=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(1)+unit;
async function openExpanded(event){event.preventDefault();const item=banks.find(b=>b.key===bank.value);if(!item||!dialog)return;const when=period.value;expanded.src=img.src;heading.textContent=item.name+' — '+(when==='tomorrow'?'Tomorrow 07:00–17:00':'Current 6 hours');meta.textContent='Loading published hourly data…';rows.replaceChildren();dialog.showModal();try{const response=await fetch(`banks/hourly/${item.key}-${when}.json`,{cache:'no-store'});if(!response.ok)throw Error('No hourly cache published');const d=await response.json();if(d.key!==item.key||d.period!==when||!d.version||!Array.isArray(d.hours)||!d.hours.length)throw Error('Invalid hourly cache');const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+(when==='tomorrow'?86400000:0)));if(d.day!==localDay)throw Error('Hourly forecast has not yet been published for '+localDay);if(!dialog.open||bank.value!==item.key||period.value!==when)return;meta.textContent=`${d.day} · ${d.freshness||'Published'} · Snapshot ${d.version} · ${d.hours.length} hours`;for(const h of d.hours){const tr=document.createElement('tr');const values=[h.time,fmt(h.avgWindKn),fmt(h.peakGustKn),fmt(h.avgWaveM==null?null:Number(h.avgWaveM)*3.28084),fmt(h.avgWavePeriodS),fmt(h.avgCurrentKn),fmt(h.rainProbabilityPct)];for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}rows.appendChild(tr)}}catch(err){meta.textContent='Hourly details unavailable: '+err.message+'. The published summary image remains available.'}}
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
    if(!live.href)return;
    // Mobile browsers: allow the existing target=_blank link to open the
    // forecast in its own tab; avoid an iframe modal beneath page content.
    if(window.matchMedia('(max-width: 767px), (pointer: coarse)').matches){
      return;
    }
    event.preventDefault();
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
