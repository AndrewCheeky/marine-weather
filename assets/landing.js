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
// The image is versioned by the latest successful image build, not by the browser clock.
const poster=document.getElementById("daily-poster");
poster.src="instagram/generated/today.png?v="+Date.now();
poster.addEventListener("error",()=>{document.getElementById("poster-fallback").hidden=false;poster.hidden=true;});
