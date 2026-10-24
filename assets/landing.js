
const BASE='https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const allowed=['current','tomorrow','weekend','banks'];
const frameHost=document.querySelector('.frame');
const status=document.getElementById('status');
const overlay=document.getElementById('loading-overlay');
const loadingTitle=document.getElementById('loading-title');
const loadingDetail=document.getElementById('loading-detail');
let currentView='';
let requestId=0;
let loadingTimer=null;
let minimumDisplayTimer=null;
const MINIMUM_SPINNER_MS=700;
function show(view){
  if(!allowed.includes(view))view='current';
  currentView=view;
  const id=++requestId;
  // Unique URL for each navigation prevents browser iframe caching.
  const url=BASE+'?action='+encodeURIComponent(view)+'&hideFooter=1&_reload='+Date.now()+'_'+id;
  const labels={current:'Current 6 Hours',tomorrow:'Tomorrow',weekend:'Weekend',banks:'Fishing Banks'};
  status.textContent='Loading '+labels[view]+'…';
  overlay.hidden=false;
  overlay.style.display='flex';
  overlay.style.opacity='1';
  const startedAt=performance.now();
  loadingTitle.textContent='Loading '+labels[view]+'…';
  loadingDetail.textContent='Please wait while the forecast opens';
  clearTimeout(loadingTimer);
  clearTimeout(minimumDisplayTimer);
  function finishLoading(message){
    if(id!==requestId)return;
    const remaining=Math.max(0,MINIMUM_SPINNER_MS-(performance.now()-startedAt));
    clearTimeout(minimumDisplayTimer);
    minimumDisplayTimer=setTimeout(()=>{
      if(id!==requestId)return;
      overlay.hidden=true;
      overlay.style.display='none';
      status.textContent=message;
    },remaining);
  }
  loadingTimer=setTimeout(()=>{
    finishLoading('The forecast is taking longer than expected. Select Refresh to try again.');
  },30000);
  // Replacing the iframe ensures a fresh navigation even if Google redirects internally.
  const next=document.createElement('iframe');
  next.id='forecast';next.title=labels[view]+' marine weather forecast';
  next.loading='eager';next.referrerPolicy='no-referrer';
  next.addEventListener('load',()=>{
    if(id!==requestId)return;
    clearTimeout(loadingTimer);
    finishLoading('Showing '+labels[view]+'.');
  });
  const previous=frameHost.querySelector('iframe');
  if(previous) previous.replaceWith(next);
  else frameHost.appendChild(next);
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===view)));
  // Keep landing-page section anchors intact; forecast selection is held in memory.
  // Two paint opportunities ensure the overlay renders before iframe navigation begins.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(id===requestId)next.src=url;}));
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
document.getElementById('refresh').addEventListener('click',()=>show(currentView));
 document.getElementById('fishing-intelligence').addEventListener('click',()=>{
   const url='https://fishing.andrewcheeky.com';
   const popup=window.open(url,'FishingIntelligence','popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes');
   if(!popup)window.open(url,'_blank','noopener,noreferrer');
   else popup.focus();
 });
document.getElementById('catch-log').addEventListener('click',()=>{
  const url='https://fishing-logs.andrewcheeky.com';
  const popup=window.open(url,'FishingCatchLog','popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes');
  if(!popup)window.open(url,'_blank','noopener,noreferrer');
  else popup.focus();
});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(allowed.includes(view))show(view);});
show(allowed.includes(location.hash.slice(1))?location.hash.slice(1):'current');
// JSONP is used because Google Apps Script's ContentService does not supply
// cross-origin fetch headers for a GitHub Pages site.
function checkMarineAlert(){
  const cb='wxMarineAlertCallback';
  const script=document.createElement('script');
  let finished=false;
  const cleanup=()=>{if(finished)return;finished=true;clearTimeout(timeout);script.remove();try{delete window[cb];}catch(_){window[cb]=undefined;}};
  window[cb]=(data)=>{
    cleanup();
    if(!data||!data.ok||!data.active||!data.message)return;
    if(!['AMBER','RED'].includes(data.level))return;
    const signature=[data.level,data.issued||'',data.message].join('|');
    try{if(sessionStorage.getItem('marineAlertAcknowledged')===signature)return;}catch(_){}
    const modal=document.getElementById('marine-alert-modal');
    const card=document.getElementById('marine-alert-card');
    const ack=document.getElementById('marine-alert-ack');
    card.classList.toggle('red',data.level==='RED');
    document.getElementById('marine-alert-title').textContent='⚠ '+data.level+' MARINE ALERT IN EFFECT';
    document.getElementById('marine-alert-message').textContent=data.message;
    document.getElementById('marine-alert-issued').textContent=(data.issued?'Issued: '+data.issued+' · ':'')+'Source: Jamaica Meteorological Service';
    modal.hidden=false;ack.focus();
    ack.onclick=()=>{try{sessionStorage.setItem('marineAlertAcknowledged',signature);}catch(_){}modal.hidden=true;};
  };
  const timeout=setTimeout(cleanup,12000);
  script.onerror=cleanup;
  script.src=BASE+'?action=marineAlert&callback='+cb+'&_t='+Date.now();
  document.head.appendChild(script);
}
checkMarineAlert();

// The image is versioned by the latest successful image build, not by the browser clock.
const poster=document.getElementById("daily-poster");
poster.src="instagram/generated/today.png?v="+Date.now();
poster.addEventListener("error",()=>{document.getElementById("poster-fallback").hidden=false;poster.hidden=true;});
