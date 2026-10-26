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
