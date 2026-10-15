# Marine Weather Jamaica — Instagram v10 (public GitHub files)

Upload only `instagram/index.html`, `scripts/generate-instagram.mjs`, and `.github/workflows/daily-instagram.yml` to the existing public repository, preserving paths. The existing `instagram/sunset-background.jpg` is included unchanged for completeness.

The poster suppresses unavailable/blank peak wind, peak wave, tides, solar values, and metric placeholders rather than printing “Unavailable”. Forecast data are still retrieved from the existing Apps Script `action=instagramData` endpoint. The GitHub workflow generates **today only** and does not generate tomorrow.

**Do not upload the separate private `.gs` file or the private ZIP to GitHub.** That file includes the existing weather service credentials. Paste it into the existing Google Apps Script project and update the **existing deployment** via Deploy → Manage deployments → Edit → New version → Deploy.

Verification: open the deployed `.../exec?action=instagramData&day=today&callback=mwInstagramCallback_123_456` URL and confirm `poster.peakWind` and `poster.peakWave` exist (blank only if no usable cached hourly data). Run GitHub Actions → Daily Marine Forecast PNG → Run workflow. This package does not change cache tables or add API requests.
