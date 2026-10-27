/* Marine Weather Jamaica: versioned offline app shell; no background forecast requests. */
const VERSION = 'mwja-pwa-v7.9.1';
const SHELL = VERSION + '-shell';
const FORECAST = VERSION + '-forecasts';
const CACHE_PREFIX = 'mwja-pwa-';
const ASSETS = [
  '/', '/index.html', '/assets/landing.css?v=7.3', '/assets/pwa.css?v=6.1',
  '/assets/landing.js', '/assets/pwa.js', '/assets/shared-footer.js',
  '/assets/shared-footer.css', '/assets/banks.js', '/assets/marine-alert.js',
  '/banks/banks.json', '/assets/jamaica-sea-sunset.jpg',
  '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.allSettled(ASSETS.map(async url => {
      // Bypass the Android/browser HTTP cache while preloading the new shell.
      const request = new Request(url, { cache: 'no-store' });
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok) await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== SHELL && name !== FORECAST)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, fallbackRequest) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return (await cache.match(request)) ||
      (fallbackRequest ? await cache.match(fallbackRequest) : undefined) ||
      Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname;

  // Pages always check the network first; keep the home page for offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL, '/index.html'));
    return;
  }

  // Forecast images and JSON must not be served from a stale cache while online.
  if (path.startsWith('/banks/generated/') || path.startsWith('/banks/hourly/') ||
      path.startsWith('/instagram/generated/')) {
    event.respondWith(networkFirst(req, FORECAST));
    return;
  }

  // Updated scripts, styles and bank listing also use network-first.
  if (path === '/banks/banks.json' || path.endsWith('.js') || path.endsWith('.css') ||
      path.endsWith('.html') || path.endsWith('.json')) {
    event.respondWith(networkFirst(req, SHELL));
    return;
  }

  // Only immutable app icons use cache-first; all other images and assets
  // check the network without consulting the Android/browser HTTP cache.
  if (path.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(req);
      if (cached) return cached;
      const response = await fetch(req, { cache: 'no-store' });
      if (response.ok) await cache.put(req, response.clone());
      return response;
    })());
    return;
  }
  event.respondWith(networkFirst(req, SHELL));
});
