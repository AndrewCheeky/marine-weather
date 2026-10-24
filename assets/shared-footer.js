/* Marine Weather Jamaica shared footer v5.9. Cross-origin safe: classic script + stylesheet, no HTML fetch or Cloudflare changes. */
(function(){
  'use strict';
  const HTML="<section class=\"explore-section section\" id=\"explore\"><div class=\"section-intro light\"><p class=\"eyebrow\">EXPLORE JAMAICA’S WATERS</p><h2>Explore Jamaica’s waters.</h2><p>From the harbour to the banks, the tools you need for a better day offshore.</p></div><div class=\"explore-grid\"><a href=\"https://marine-weather.andrewcheeky.com/#bank-snapshots\" class=\"explore-card\"><span class=\"card-art art-waves\" aria-hidden=\"true\"></span><span class=\"card-text\"><strong>Bank forecasts</strong><small>Wind, seas, wave periods & currents</small><b>↗</b></span></a><a href=\"https://fishing.andrewcheeky.com/\" class=\"explore-card\"><span class=\"card-art art-fish\" aria-hidden=\"true\"></span><span class=\"card-text\"><strong>Fishing intelligence</strong><small>Explore offshore fishing insights</small><b>↗</b></span></a><a href=\"https://fishing-logs.andrewcheeky.com\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"explore-card\"><span class=\"card-art art-log\" aria-hidden=\"true\"></span><span class=\"card-text\"><strong>Fishing catch logs</strong><small>Record and review your catches</small><b>↗</b></span></a><a href=\"https://iriefins.nfa.gov.jm/application-types\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"explore-card\"><span class=\"card-art art-permit\" aria-hidden=\"true\"></span><span class=\"card-text\"><strong>Fishing Licences &amp; Permits</strong><small>Official fisheries applications and approvals</small><b>↗</b></span></a></div><div class=\"explore-actions\"><button type=\"button\" data-mw-action=\"intelligence\" class=\"btn btn-yellow\">Open Fishing Intelligence ↗</button><button type=\"button\" data-mw-action=\"logs\" class=\"btn btn-outline\">Open Fishing Logs ↗</button></div></section>\n<section class=\"closing\" id=\"about\"><div><p class=\"eyebrow\">BORN OF THE ISLAND. BUILT FOR THE SEA.</p><h2>Same sea. <em>Brighter days.</em></h2><p>Local marine guidance to help Jamaica's boating, fishing and coastal communities plan with confidence.</p></div></section>\n<footer class=\"site-footer\"><div class=\"footer-brand\"><span class=\"brand-wave\">≋</span><span><strong>MARINE WEATHER</strong><small>JAMAICA</small></span></div><p>Plan · Fish · Explore</p><p>Forecast guidance only. Not for navigation.</p><p>© Marine Weather Jamaica</p></footer>\n";
  const BASE='https://marine-weather.andrewcheeky.com/';
  const root=document.getElementById('marine-shared-footer');
  if(!root || root.shadowRoot) return;
  const shadow=root.attachShadow({mode:'open'});
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href=BASE+'assets/shared-footer.css?v=5.9';
  shadow.appendChild(link);
  const shell=document.createElement('div');
  shell.innerHTML=HTML;
  shadow.appendChild(shell);
  shadow.querySelector('[data-mw-action="intelligence"]')?.addEventListener('click',()=>window.location.assign('https://fishing.andrewcheeky.com/'));
  shadow.querySelector('[data-mw-action="logs"]')?.addEventListener('click',()=>{
    const popup=window.open('https://fishing-logs.andrewcheeky.com/','FishingCatchLog','popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes');
    if(!popup) window.location.assign('https://fishing-logs.andrewcheeky.com/');
    else popup.focus();
  });
})();
