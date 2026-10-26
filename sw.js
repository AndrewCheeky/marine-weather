/* Marine Weather Jamaica: offline app shell, no background forecast requests. */
const VERSION='mwja-pwa-v7.3';
const SHELL=VERSION+'-shell',FORECAST=VERSION+'-forecasts';
const ASSETS=['/','/index.html','/assets/landing.css?v=7.3','/assets/pwa.css?v=6.1','/assets/landing.js','/assets/pwa.js','/assets/shared-footer.js','/assets/shared-footer.css','/assets/banks.js','/assets/marine-alert.js','/banks/banks.json','/assets/jamaica-sea-sunset.jpg','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(async cache=>{await Promise.allSettled(ASSETS.map(u=>cache.add(u)));}));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('mwja-pwa-')&&k!==SHELL&&k!==FORECAST)await caches.delete(k);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return; // Never intercept external forecast/advisory endpoints.
 const path=url.pathname;
 if(req.mode==='navigate'){
   event.respondWith((async()=>{try{const response=await fetch(req);if(response.ok){const cache=await caches.open(SHELL);await cache.put('/index.html',response.clone());}return response;}catch{return (await caches.match('/index.html'))||Response.error();}})());return;
 }
 if(path.startsWith('/banks/generated/')||path.startsWith('/instagram/generated/')){
   event.respondWith((async()=>{try{const response=await fetch(req);if(response.ok){const cache=await caches.open(FORECAST);await cache.put(req,response.clone());}return response;}catch{return (await caches.match(req))||Response.error();}})());return;
 }
 if(path==='/banks/banks.json'){
   event.respondWith((async()=>{try{const response=await fetch(req);if(response.ok){const cache=await caches.open(SHELL);await cache.put(req,response.clone());}return response;}catch{return (await caches.match(req,{ignoreSearch:true}))||Response.error();}})());return;
 }
 event.respondWith((async()=>{const cached=await caches.match(req,{ignoreSearch:true});if(cached)return cached;const response=await fetch(req);if(response.ok){const cache=await caches.open(SHELL);await cache.put(req,response.clone());}return response;})());
});
