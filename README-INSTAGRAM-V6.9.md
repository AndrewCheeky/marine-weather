# v6.9 — User-approved marine poster layout

The 1080×1600 Sharp generator now uses the selected poster layout: coastal header, large condition banner, weather icons, fishing-bank underwater illustrations, tide and sun/moon panels, and safety footer. Condition-specific GOOD/FAIR/POOR background photographs are preserved. All numbers, dates, status labels, and moon phase come from the verified forecast payload; decorative bank imagery and target-species text are illustrative only and do not represent predictions of fish presence.

Changed: `scripts/generate-instagram-sharp.mjs`. Added: `instagram/art/{pelagic,reef,kingston,moon}.jpg`. The GitHub workflow, endpoint, existing pages and all other scripts are unchanged.

Use Actions → Daily Marine Forecast PNG → Run workflow for a manual regeneration; the existing image is preserved if data validation fails. For a local illustrative test with Sharp installed, run `node scripts/generate-instagram-sharp.mjs --preview`.
