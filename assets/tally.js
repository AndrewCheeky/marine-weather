/* Anonymous counts of what is used on this page (which banks, which features), added up per day.
   Sends only: island, "marine", the bank and the kind of action. No name, ID, cookie or location.
   Each action is counted at most once per page visit, and never on a local copy. */
(()=>{'use strict';
const URL='https://script.google.com/macros/s/AKfycbyFY483SYd2P772OZbtMiMTD6CUUuTwLFsJBm2GLxmxmZk2uBm9oUr2N2emOf41L1_CTw/exec';
const sent=new Set();
window.MWTally=(kind,bank)=>{
  if(!bank||/^(localhost|127\.|\[::1\])/.test(location.hostname)||location.protocol==='file:')return;
  const id=kind+'|'+bank;if(sent.has(id))return;sent.add(id);
  const q=new URLSearchParams({action:'tally',t:'JM',m:'marine',p:String(bank).toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,60),k:kind});
  try{fetch(URL+'?'+q,{mode:'no-cors',keepalive:true,credentials:'omit'}).catch(()=>{});}catch{}
};
})();
