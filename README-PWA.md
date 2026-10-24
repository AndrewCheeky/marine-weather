# Marine Weather Jamaica PWA — v6.1

Upload these files to the ROOT of the existing `marine-weather` GitHub Pages repository, retaining the `.github` folder and all existing generated images; commit to `main`. This ZIP is a full website snapshot based on the supplied v6.0 package. If your live index.html has newer edits, merge only the PWA tags, notice and pwa.js reference instead of overwriting.

New files: `manifest.webmanifest`, `sw.js`, `assets/pwa.js`, `assets/pwa.css`, `icons/icon-192.png`, `icons/icon-512.png`. Modified: `index.html` only. No Apps Script changes.

Visit https://marine-weather.andrewcheeky.com/ over HTTPS; Android Chrome: menu > Add to Home screen / Install app. iPhone Safari: Share > Add to Home Screen.

Offline: app shell and previously viewed images may remain available. Forecasts and advisory feeds are NOT refreshed offline. The app shows an offline safety notice; never treat cached information as current. Service worker caches only same-origin content, not Google Apps Script or external marine warnings.

Updates: service worker uses a versioned cache. When changing static files, increment VERSION in sw.js and update ASSETS paths as needed. Cache-first static assets may remain until the worker updates.

Check: DevTools > Application > Manifest and Service Workers; verify installability, then toggle Offline and reload. On GitHub Pages with a custom domain at the root, `/sw.js` controls the site.
