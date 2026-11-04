# Phase 2: Seven-day marine outlook

This patch is based on `marine-weather-main (16).zip`. It adds an independent seven-day renderer and workflow and a seven-button selector. **Existing `today.png`, `tomorrow.png`, and daily workflow are untouched.** The new posters intentionally use a simpler layout than the existing daily Instagram poster because the validated feed does not contain authoritative comfort scores, fishing scores, departure/return windows, tides or lunar calculations. Do not treat the provisional GAS status as an official score.

## Before deploying to GitHub

1. Keep your tested `SevenDayForecastFeed.gs` v1.1 installed in the production Apps Script project.
2. At the beginning of your **existing** `doGet(e)` function, before other routing, add:

```js
if (e && e.parameter && String(e.parameter.action || '').toLowerCase() === 'sevendaydata') {
  return mwSevenDayData_(e);
}
```

3. Save and deploy the existing web app as a **new version** with the same access policy. Do not add a second `doGet`.
4. Test the existing deployment URL with `?action=sevenDayData&callback=mwInstagramCallback_123_456` (use `&` instead of `?` if the URL already has query parameters). The response should start `mwInstagramCallback_123_456({"ok":true,...` and include seven dates.
5. In GitHub repository **Settings > Secrets and variables > Actions**, create repository secret `SEVEN_DAY_DATA_URL` containing the web app `/exec` URL, without query parameters. Do not commit this URL or any private credentials.
6. Upload the changed files from this patch, retaining their relative paths. In GitHub Actions run **Seven-Day Marine Outlook > Run workflow** manually once.
7. Check `instagram/generated/seven-day-manifest.json` and seven `seven-day-YYYY-MM-DD.png` files after successful execution, then check the website. The selector is hidden until the manifest includes today plus six days, so the old daily poster remains visible until the new data is ready.

## Styling and behavior

- Days 1–3 use **green** buttons and show `SHORT-RANGE FORECAST`.
- Days 4–7 use **orange** buttons and show `EXTENDED OUTLOOK`.
- 7 AM to 5 PM Jamaica time, 10 hourly periods per day.
- Seven-day poster images are 1080×1560 PNG. The existing today/tomorrow images remain separate and unchanged.
- The website switches images without a full page reload. Missing or stale seven-day data does not overwrite an existing published PNG; a failed workflow does not commit partial changes.
- Forecast values are descriptive only, not a substitute for official marine warnings. Raw current velocity is explicitly labelled `raw` because units were not verified.

## Automation

The new workflow runs at 11:45 UTC (06:45 Jamaica) and can also be run manually. It runs separately from the existing daily workflow. GitHub scheduled jobs may be delayed.

## Remaining enhancements

To reproduce **the full existing Instagram poster design** on all seven days, the read-only feed must also provide the established production safety/comfort scores, destination departure/return windows, tide and moon information and fishing intelligence. This patch does not invent them.
