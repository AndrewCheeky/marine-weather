// The image is versioned by the latest successful image build, not by the browser clock.
const poster=document.getElementById("daily-poster");
poster.src="instagram/generated/today.png?v="+Date.now();
poster.addEventListener("error",()=>{document.getElementById("poster-fallback").hidden=false;poster.hidden=true;});
