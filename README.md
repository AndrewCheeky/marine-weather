# Marine Weather Jamaica — Bank Forecast Gallery v4.2

Upload the contents of this ZIP to the **root** of your existing `marine-weather` repository. Replace root `index.html`, `assets/landing.css`, `assets/landing.js` only if those are the matching v4 landing files; this package preserves the v4 design and existing dynamic forecast views. Add `assets/banks.js`, `banks/banks.json`, `scripts/generate-bank-forecasts.mjs`, and `.github/workflows/bank-forecast-images.yml`. **Do not delete existing `instagram/`, `.github/workflows/daily-instagram.yml`, or `CNAME`.** No Apps Script credentials are included.

## What this does

Adds a Jamaica-themed **Fishing Bank Forecasts** dropdown covering 13 named locations, with **Tomorrow** and **Current** views. The cached image is a screenshot of the **existing live Google Apps Script bank forecast** (not a fabricated data infographic). Each bank has a direct live forecast fallback. Missing or invalid images are not shown. A separate GitHub Action refreshes bank snapshots every three hours, without changing the subscriber email, forecast calculations, Instagram image generator, or MarineCache.

## First use

1. Verify `banks/banks.json` **keys** match the `key` column in your live Apps Script `banks` sheet. The first two (`bowditch`, `california`) are confirmed from the source; other keys are proposed and must be checked. If a key differs, change it in the JSON and rerun the workflow.
2. Commit files to `main`, then run **Actions → Cached Bank Forecast Images → Run workflow**.
3. Read the log for `PUBLISHED` and `SKIPPED`; the latter means no image was overwritten. The dropdown offers a live link even if the image is absent.
4. GitHub Pages will serve `banks/generated/<key>-tomorrow.webp` and `<key>-current.webp` after the image commit and Pages publish. Check Pages and Cloudflare caching if new files don't appear.

## Important limitations

The supplied Apps Script exposes bank-specific **HTML**, not the full structured hourly forecast, weather synopsis, sunrise/sunset, and moon/tide JSON needed to faithfully recreate the illustrated *full infographic*. This implementation deliberately screenshots the **real bank HTML** to avoid inventing figures or silently substituting data. To create the full matching graphic per bank, a read-only structured `bankForecastData` endpoint is needed in GAS; it should reuse the existing forecast summary calculations and return available hourly/astronomy fields. That endpoint is **not** included here and the existing GAS is unchanged.

The screenshot workflow visits up to 26 bank pages per run and can be expensive if those pages trigger forecast-provider calls; review API quotas and consider switching to a single batch data endpoint before enabling the schedule at full scale. GitHub cron may run late. Image content may be stale if a previous snapshot is retained; always use the forecast's actual timestamp and live link. This is not for navigation.
