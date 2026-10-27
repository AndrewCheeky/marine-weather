(()=>{'use strict';
const notice=document.getElementById('pwa-offline-notice');
function status(){if(notice)notice.hidden=navigator.onLine;}
window.addEventListener('online',status);window.addEventListener('offline',status);status();
if('serviceWorker' in navigator && location.protocol==='https:'){let reloaded=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloaded && navigator.serviceWorker.controller){reloaded=true;location.reload();}});window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(reg=>reg.update()).catch(err=>console.warn('Offline support unavailable:',err.message));});}
})();
