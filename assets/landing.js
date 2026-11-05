// Daily image remains a fallback only if the seven-day manifest is unavailable.
const poster=document.getElementById('daily-poster');
poster.addEventListener('error',()=>{document.getElementById('poster-fallback').hidden=false;poster.hidden=true;});

// Seven-day posters are optional. Existing daily poster remains the fallback.
(async function initSevenDay(){
 const nav=document.getElementById('seven-day-select');
 const img=document.getElementById('daily-poster');
 const caption=document.querySelector('.poster-caption');
 const fallback=document.getElementById('poster-fallback');
 if(!nav||!img)return;
 const jaDate=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
 try{
  const res=await fetch(`instagram/generated/seven-day-manifest.json?v=${Date.now()}`,{cache:'no-store'});
  if(!res.ok) return;
  const manifest=await res.json();
  if(!Array.isArray(manifest.days)||manifest.days.length!==7||!manifest.days.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&/^instagram\/generated\/seven-day-\d{4}-\d{2}-\d{2}\.png$/.test(d.image)&&d.image.endsWith(d.date+'.png')))return;
  const currentDay=jaDate();
  const firstAvailable=manifest.days.findIndex(d=>d.date>=currentDay);
  const initialIndex=firstAvailable>=0?firstAvailable:0;
  let selected=-1;
  function choose(index){
   const item=manifest.days[index];if(!item)return;
   selected=index;
   const url=item.image+`?date=${item.date}&v=${encodeURIComponent(manifest.generatedAt||item.date)}`;
   img.hidden=false;fallback.hidden=true;
   img.src=url;
   img.alt=`Jamaica marine ${item.outlook==='extended'?'extended outlook':'short-range forecast'} for ${item.date}, 7 AM to 5 PM`;
   if(caption)caption.innerHTML=`${item.outlook==='extended'?'Extended outlook · Greater uncertainty':'Short-range marine forecast'} · <a href="${url}" target="_blank" rel="noopener">View full size ↗</a>`;
   [...nav.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
  }
  const previousSrc=img.src;
  const previousCaption=caption?.innerHTML;
  img.addEventListener('error',()=>{
   if(selected>=0){selected=-1;img.src=previousSrc;img.hidden=false;if(caption)caption.innerHTML=previousCaption;}
  });
  manifest.days.forEach((item,i)=>{
   const b=document.createElement('button');b.type='button';const status=String(item.status||'').toUpperCase();b.className='seven-day-button '+(['GREEN','YELLOW','AMBER','RED'].includes(status)?'seven-day-'+status.toLowerCase():'seven-day-unknown');
   const day=new Date(item.date+'T12:00:00Z');
   const name=new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(day);
   b.textContent=`${name} ${day.getUTCDate()}`;
   b.title=(item.status||'Unrated')+' · '+(item.outlook==='extended'?'Extended outlook, greater uncertainty':'Short-range forecast');
   b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>choose(i));nav.appendChild(b);
  });
  nav.hidden=false;choose(initialIndex);
 }catch(e){console.warn('Seven-day outlook unavailable; current daily poster preserved.');}
})();
