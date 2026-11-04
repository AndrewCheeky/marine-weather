// The image is versioned by the latest successful image build, not by the browser clock.
const poster=document.getElementById("daily-poster");
poster.src="instagram/generated/today.png?v="+Date.now();
poster.addEventListener("error",()=>{document.getElementById("poster-fallback").hidden=false;poster.hidden=true;});

// Bust browser and service-worker caches when a new Jamaica-day image is published.
(function(){
  const img=document.getElementById('daily-poster');
  if(!img)return;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const day=`${p.year}-${p.month}-${p.day}`;
  img.src=`instagram/generated/today.png?day=${day}&design=v6.4&refresh=${Math.floor(Date.now()/600000)}`;
  const full=document.querySelector('.poster-caption a[href*="today.png"]');
  if(full)full.href=img.src;
})();

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
  if(!Array.isArray(manifest.days)||manifest.days.length!==7||manifest.days[0].date!==jaDate())return;
  let selected=-1;
  function choose(index){
   const item=manifest.days[index];if(!item)return;
   selected=index;
   const url=item.image+`?date=${item.date}&v=${encodeURIComponent(manifest.generatedAt)}`;
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
   const b=document.createElement('button');b.type='button';b.className='seven-day-button '+(i<3?'seven-day-short':'seven-day-extended');
   const day=new Date(item.date+'T12:00:00Z');
   const name=new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(day);
   b.textContent=`${name} ${day.getUTCDate()}`;
   b.title=i<3?'Short-range forecast':'Extended outlook';
   b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>choose(i));nav.appendChild(b);
  });
  nav.hidden=false;choose(0);
 }catch(e){console.warn('Seven-day outlook unavailable; current daily poster preserved.');}
})();
