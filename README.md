# Marine Weather — true forecast-ready overlay

This update requires BOTH files to be deployed together.

1. Back up your Google Apps Script project. Replace its existing v3.8.5 source with `Marine_Weather_v3.8.5_ready_signal.gs` (do not publish this source in GitHub). Save. Deploy > Manage deployments > Edit existing web app > New version > Deploy. Keep the existing web-app URL.
2. Upload `index.html` to the ROOT of the public GitHub `marine-weather` repository and commit. Wait for GitHub Pages to deploy.
3. Hard-refresh https://marine-weather.andrewcheeky.com and test all buttons.

The overlay stays up until the Apps Script HTML response sends a matching `marine-weather:ready` message after browser load. A 30-second notice does NOT dismiss it. If the script fails or a login/redirect page blocks messaging, the overlay remains until a refresh; this avoids falsely claiming data is ready. The backend message does not contain forecast or private information.

The backend allows iframe embedding on its public HTML responses. Do not expose private or authenticated pages through this endpoint. Forecast emails, scheduling, and cache logic are unchanged.
