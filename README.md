# Marine Weather — Loading overlay reliability fix

This package replaces only the GitHub Pages `index.html`. No Google Apps Script or Cloudflare changes are needed.

## Loading behavior

- The overlay is visible immediately on initial navigation and each forecast change.
- An authenticated Apps Script ready message closes the overlay immediately.
- If the Apps Script sandbox does not deliver that message, the overlay closes 2.5 seconds after the iframe load event. This is a fallback, **not** proof that all asynchronous content is ready.
- If the iframe never finishes loading, the overlay remains visible with a longer-loading message after 30 seconds; use Refresh to retry.
- The direct Google Apps Script link is not displayed.

## Deploy

Replace `index.html` at the root of `andrewcheeky/marine-weather`, commit to `main`, wait for GitHub Pages deployment, then hard-refresh https://marine-weather.andrewcheeky.com.

## Architectural note

A reliable data-complete signal requires the backend to emit a verified completion message from the final rendered page or serving data via an API. Google Apps Script HTML Service sandbox behavior may prevent this cross-origin handshake; iframe load fallback is a pragmatic compromise.
