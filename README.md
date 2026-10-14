# Marine Weather Instagram v6 — NOAA-style sunrise/sunset

## GitHub update
Upload **only** `instagram/`, `scripts/` and `.github/workflows/` from this package to the public repository. Do not upload `apps-script/` to GitHub because it contains private service credentials.

## Google Apps Script
Backup the existing main script. Replace its contents with `apps-script/MarineWeather_v3_8_5d_Instagram_Integrated.gs`, save, then Deploy → Manage deployments → Edit → New version → Deploy. Do not add `InstagramData.gs` separately.

## Changes
Sunrise/sunset use NOAA Solar Calculator-style solar geometry (equation of time, declination, iterative hour angle, 90.833° apparent zenith), Jamaica local time, no extra API calls. Existing poster, moon, tides, and two-PNG workflow preserved.

## Testing
Test `action=instagramData&day=today` and `day=tomorrow`; verify `poster.sunrise` and `poster.sunset`. Then GitHub Actions → Daily Today and Tomorrow Marine Forecast PNGs → Run workflow. Expect `instagram/generated/today.png` and `instagram/generated/tomorrow.png` when each day's cache is ready. Scheduled 11:30 UTC (06:30 Jamaica).

Sunrise/sunset are predictions for a standard sea-level horizon, not observations; terrain, elevation, and atmospheric refraction may shift visibility.
