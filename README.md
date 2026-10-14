# Marine Weather Jamaica — Daily Instagram PNG automation (v2)

This package is intended to be **merged into the existing Marine Weather GitHub repository**, not uploaded as a replacement repository. Keep the existing homepage and other files unchanged.

## Apps Script: private backend (DO NOT upload to GitHub)

`apps-script/MarineWeather_v3_8_5d_Instagram_Integrated.gs` is the supplied October 14 Apps Script with only one additional `doGet(e)` routing branch and the appended `InstagramData.gs` read-only endpoint. It is provided for direct replacement **inside Google Apps Script only**. It may contain existing private credentials from the original supplied script. Never commit the `apps-script/` directory to any public GitHub repository. Better: copy `apps-script/InstagramData.gs` as a new file and add the 4-line routing branch to the existing `doGet(e)` to minimize changes.

Back up your existing script, then deploy **Manage deployments > Edit > New version**, retaining the existing public deployment URL and access settings. Test `.../exec?action=instagramData&day=tomorrow&callback=mwInstagramCallback_123_1` in browser. A valid result begins `mwInstagramCallback_123_1({...});`.

## GitHub repository: public frontend and automation

Copy ONLY these items into the root of the current Marine Weather repository:

- `instagram/index.html`
- `instagram/sunset-background.jpg`
- `scripts/generate-instagram.mjs`
- `.github/workflows/daily-instagram.yml`

Do **not** replace the root `index.html`. The workflow requires GitHub Actions to have repository **Read and write permissions** (Settings > Actions > General > Workflow permissions). It uses Chromium via Playwright to open the deployed poster, wait for the forecast safety validation, save the 1080×1080 PNG and commit both dated and `latest.png` to `instagram/generated/`.

**Schedule:** every day at 06:30 Jamaica time (11:30 UTC). The default image forecasts **tomorrow 07:00–17:00**. GitHub scheduled runs may be delayed; no guarantee of minute-precise delivery. For a same-day poster, change `FORECAST_DAY` to `today` in the workflow. The generated image is **not posted to Instagram automatically**.

Once GitHub Pages deploys the committed file, the stable image URL will be `https://marine-weather.andrewcheeky.com/instagram/generated/latest.png`. The dated image will be `/instagram/generated/marine-weather-jamaica-YYYY-MM-DD.png`.

## First test

1. Deploy Apps Script and verify its JSONP response.
2. Merge public files into GitHub; wait for Pages deployment.
3. Go to GitHub > Actions > Daily Instagram Marine Forecast PNG > Run workflow.
4. Confirm a green workflow and the `instagram/generated/latest.png` file.
5. Check PNG carefully against the live forecast before using it publicly.

The workflow fails **without committing a new image** if the forecast is stale, required locations lack cached data, the endpoint is unreachable or the renderer fails. Existing `latest.png` remains from the last successful run, so check its date before reuse. No extra weather API requests are made by the endpoint.

### Notes

- The poster shows cached rainfall rate (mm/hr), **not probability of precipitation**.
- This version uses the cached comfort colors and weather metrics for Kingston/Maiden Cay, Mackerel and California Bank.
- The live Apps Script script and poster have not been tested against your Google account or production deployment. Browser automation is provided but must be enabled in your repository.
- For marine safety, official warnings always take precedence; the poster is not for navigation.
