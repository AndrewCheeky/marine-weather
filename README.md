# Marine Weather — ready-signal compatibility fix

The previous frontend rejected valid readiness messages sent by some Google Apps Script sandboxed documents because their message origin can be `null`. The frontend now permits that origin only when a unique cryptographically random token and the expected forecast action match. The Apps Script response sends the ready message to both parent and top-level windows, covering nested frames.

## Install both updates

1. Back up the existing Apps Script project. Replace its script with `Marine_Weather_v3.8.5_ready_signal.gs`, save, then Deploy > Manage deployments > Edit > New version > Deploy. Keep the existing web app URL.
2. Replace the root `index.html` in GitHub repository `marine-weather`, commit to `main`, and wait for Pages deployment.
3. Hard-refresh https://marine-weather.andrewcheeky.com and test initial load, Current, Tomorrow, Weekend, and Fishing Banks.

The spinner is **not** dismissed by iframe `load`; it waits for the matching backend signal. If the backend signal is blocked or absent, it will remain visible. Check the browser console for `postMessage` errors if so. The backend source may contain credentials; do not publish it to GitHub.
