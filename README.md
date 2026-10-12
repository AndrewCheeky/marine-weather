# Marine Weather — GitHub Pages pilot (navigation fix)

Repository: `andrewcheeky/marine-weather`

Test URL: https://andrewcheeky.github.io/marine-weather/

This update replaces the iframe on each navigation, appends a unique reload parameter to avoid stale iframe pages, and adds a Refresh button and loading status. It does not change Google Apps Script, the subscriber system, or forecast calculations.

## Update GitHub

1. Open the `marine-weather` repository on GitHub.
2. Open `index.html`, click the pencil (Edit), and replace its contents with this package's `index.html`; commit to `main`. Alternatively upload and overwrite the file using GitHub's web interface.
3. Go to Actions and wait for the Pages deployment to finish.
4. Hard-refresh the test URL (Cmd+Shift+R on Mac or Ctrl+Shift+R on Windows).
5. Test all four tabs and the Refresh button.

Note: The iframe still depends on Google Apps Script permitting embedding. The reload query parameter refreshes the web page, but does **not** force a weather-provider API refresh; the Apps Script cache and its existing refresh schedules remain in effect.

Keep the Apps Script `.gs` source and API credentials out of this public repository.
