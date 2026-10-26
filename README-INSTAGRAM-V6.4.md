# Instagram graphic redesign v6.4

- Uses Sharp with embedded local coastal photograph and SVG panels; no Chromium required.
- Manual workflow dispatch **always regenerates** today’s image; scheduled 05:30/06:30 Jamaica runs skip when the dated image already exists.
- Generates `instagram/generated/today.png` and the Jamaica-date PNG only after validated fresh source data; failed fetch leaves old images untouched.
- Website appends Jamaica-day + design cache-buster to the displayed PNG.
- New design includes headline, overall forecast, bank comparisons, tides, moon and other metrics; absent source fields display em dash, never fabricated values.
- Run `node scripts/generate-instagram-sharp.mjs --preview` to render an **illustrative** design preview without touching production PNGs.
- Deploy and run GitHub Actions > Daily Marine Forecast PNG > Run workflow to replace today’s image, then hard-refresh the website.
- Browser and GitHub Pages caches may briefly show an older image until deployment propagates.
