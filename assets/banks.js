(()=>{'use strict';
const ENDPOINT='https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const bank=document.getElementById('bank-select'),period=document.getElementById('bank-period'),img=document.getElementById('bank-image'),link=document.getElementById('bank-image-link'),live=document.getElementById('bank-live'),state=document.getElementById('bank-image-state'),title=document.getElementById('bank-title');
if(!bank)return;
let banks=[];
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
