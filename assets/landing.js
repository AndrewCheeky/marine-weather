// Seven-day homepage: use the published manifest; never hide the day controls.
(()=>{
  const nav=document.getElementById('seven-day-select');
  const img=document.getElementById('daily-poster');
  const caption=document.querySelector('.poster-caption');
  const fallback=document.getElementById('poster-fallback');
  const explanation=document.getElementById('seven-day-explanation');
  if(!nav||!img)return;
  const base='instagram/generated/';
  const original=base+'today.png';
  const jaDate=()=>{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
  const label=d=>{const dt=new Date(d+'T12:00:00Z');return new Intl.DateTimeFormat('en-US',{weekday:'short',day:'numeric',timeZone:'UTC'}).format(dt);};
  let activeUrl='';
  function showError(){
    if(activeUrl!==original){activeUrl=original;img.src=original+'?v='+Date.now();}
    else {img.hidden=true;if(fallback)fallback.hidden=false;}
  }
  img.addEventListener('error',showError);
  function setImage(url,alt,captionText){
    activeUrl=url.split('?')[0];img.hidden=false;if(fallback)fallback.hidden=true;
    img.src=url;img.alt=alt;
    if(caption){caption.replaceChildren(document.createTextNode(captionText+' · '));const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent='View full size ↗';caption.appendChild(a);}
  }
  // Preserve a visible explanation even when the manifest cannot be fetched.
  if(explanation)explanation.hidden=false;
  (async()=>{
    try{
      const response=await fetch(base+'seven-day-manifest.json?refresh='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw new Error('Manifest unavailable');
      const manifest=await response.json();
      if(!Array.isArray(manifest.days)||manifest.days.length!==7)throw new Error('Expected seven forecast days');
      const days=manifest.days.map((item,i)=>{
        if(!validDate(item.date))throw new Error('Invalid forecast date');
        // Support either published manifest filename convention; never point to today.png for a forecast day.
        let path=typeof item.image==='string'?item.image.trim():'';
        if(!/^instagram\/generated\/seven-day-\d{4}-\d{2}-\d{2}\.png$/.test(path) && !/^seven-day-\d{4}-\d{2}-\d{2}\.png$/.test(path))path='seven-day-'+item.date+'.png';
        if(!path.startsWith(base))path=base+path;
        return {...item,path,extended:item.outlook==='extended'||i>=3};
      });
      nav.replaceChildren();
      const buttons=[];
      function choose(i){
        const item=days[i];if(!item)return;
        const url=item.path+'?date='+item.date+'&v='+encodeURIComponent(manifest.generatedAt||Date.now());
        setImage(url,`Marine forecast for ${item.date}`,item.extended?'Extended marine outlook · Greater uncertainty':'Short-range marine forecast');
        buttons.forEach((button,j)=>button.setAttribute('aria-pressed',String(i===j)));
        if(explanation)explanation.textContent=(item.extended?'Extended outlook: greater forecast uncertainty. ':'Short-range outlook. ')+`Forecast for ${label(item.date)} · 07:00–17:00 Jamaica time. Select another day to compare conditions.`;
      }
      days.forEach((item,i)=>{
        const button=document.createElement('button');button.type='button';
        const status=String(item.status||'').toUpperCase();
        button.className='seven-day-button seven-day-'+(['GREEN','YELLOW','AMBER','RED'].includes(status)?status.toLowerCase():'unknown');
        button.textContent=label(item.date);button.title=(item.extended?'Extended outlook, greater uncertainty':'Short-range forecast')+(status?' · '+status:'');
        button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>choose(i));
        buttons.push(button);nav.appendChild(button);
      });
      nav.hidden=false;
      const today=jaDate();const idx=days.findIndex(d=>d.date>=today);
      choose(idx<0?0:idx);
    }catch(error){
      console.warn('Seven-day manifest unavailable:',error);
      nav.hidden=false;
      const p=document.createElement('p');p.className='seven-day-unavailable';p.textContent='Seven-day forecast selection is temporarily unavailable. Showing the latest daily image.';
      nav.replaceChildren(p);
      setImage(original+'?refresh='+Date.now(),'Latest published daily marine forecast','Latest published daily forecast');
    }
  })();
})();
