(()=>{'use strict';
const notice=document.getElementById('pwa-offline-notice');
function status(){if(notice)notice.hidden=navigator.onLine;}
window.addEventListener('online',status);window.addEventListener('offline',status);status();
if('serviceWorker' in navigator && location.protocol==='https:')window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(err=>console.warn('Offline support unavailable:',err.message));});
})();
