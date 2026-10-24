/* Marine Weather Jamaica: verified active advisory popup, isolated from forecast UI. */
(()=>{'use strict';
  const ENDPOINT='https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
  const modal=document.getElementById('marine-alert-modal');
  const card=document.getElementById('marine-alert-card');
  const ack=document.getElementById('marine-alert-ack');
  if(!modal||!card||!ack)return;
  const POLL_MS=5*60*1000;
  let lastFocus=null, pending=false, shownSignature='', acknowledged='';
  const memoryKey='marineWeatherAlertAcknowledged';
  try{acknowledged=sessionStorage.getItem(memoryKey)||'';}catch(_){}
  const hide=()=>{modal.hidden=true;if(lastFocus?.isConnected)lastFocus.focus();};
  function display(data){
    if(data?.ok!==true||data.active!==true||!['AMBER','RED'].includes(data.level)||typeof data.message!=='string')return;
    const message=data.message.trim();
    if(message.length<8||message.length>1200)return;
    // Require a clearly identified active alert from the configured marine advisory endpoint.
    const signature=JSON.stringify([data.level,data.issued||'',message]);
    if(signature===acknowledged||signature===shownSignature)return;
    shownSignature=signature;
    card.classList.toggle('red',data.level==='RED');
    document.getElementById('marine-alert-title').textContent='⚠ '+data.level+' MARINE ALERT IN EFFECT';
    document.getElementById('marine-alert-message').textContent=message;
    document.getElementById('marine-alert-issued').textContent=(data.issued?'Issued: '+data.issued+' · ':'')+'Check the official advisory for its current validity and affected waters.';
    lastFocus=document.activeElement;
    modal.hidden=false;ack.focus();
    ack.onclick=()=>{acknowledged=signature;try{sessionStorage.setItem(memoryKey,signature);}catch(_){}hide();};
  }
  function check(){
    if(pending)return;
    pending=true;
    const callback='mwMarineAlert_'+Date.now()+'_'+Math.floor(Math.random()*1000000);
    const script=document.createElement('script');
    let completed=false;
    function finish(){if(completed)return;completed=true;pending=false;clearTimeout(timer);script.remove();try{delete window[callback];}catch(_){window[callback]=undefined;}}
    const timer=setTimeout(finish,15000);
    window[callback]=data=>{finish();display(data);};
    script.onerror=finish;
    script.src=ENDPOINT+'?action=marineAlert&callback='+encodeURIComponent(callback)+'&_t='+Date.now();
    document.head.appendChild(script);
  }
  document.addEventListener('keydown',e=>{
    if(modal.hidden)return;
    if(e.key==='Escape'){e.preventDefault();ack.click();}
    if(e.key==='Tab'){
      const focusables=Array.from(modal.querySelectorAll('button,a[href]')).filter(el=>!el.hidden);
      if(!focusables.length)return;
      const first=focusables[0],last=focusables[focusables.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  check();setInterval(()=>{if(!document.hidden)check();},POLL_MS);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
})();
