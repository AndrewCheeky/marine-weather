# Marine Weather Instagram v7 — peak wind and peak wave

Adds cached maximum hourly sustained wind and wave height, with earliest matching local hour, beneath the main WIND / GUSTS and SEAS figures. Forecast window 07:00–17:00 Jamaica time. No new weather API requests.

## Install
1. Replace the main Google Apps Script code with `apps-script/MarineWeather_v3_8_5d_Instagram_Integrated.gs` (make a backup first). Redeploy existing web app as **New version**. Do not upload Apps Script code to public GitHub; it contains private configuration.
2. Replace `instagram/index.html` in GitHub. The existing background, generator and workflow are included for convenience and can be retained unchanged if already working.
3. Run the GitHub Actions workflow and verify both peak fields in the JSONP endpoint and poster.

Peak values are read from cached `peakWindKn` and `peakWaveM` columns for each local hourly slot. Tied peaks use the earliest hour. If missing, display Unavailable. The displayed time is the cached hourly forecast slot, not a sub-hour precise instant.
