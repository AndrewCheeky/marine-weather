# Marine Weather Jamaica — landing page v4.0

Deploy the files to the **repository root** of `AndrewCheeky/marine-weather`:

- `index.html` — replace the **root** landing page (not `instagram/index.html`)
- `assets/landing.css` — new
- `assets/landing.js` — new
- `assets/jamaica-sea-sunset.jpg` — new, reused from the repository's existing sunset image

Leave `.github/workflows/`, `scripts/`, `instagram/`, `CNAME` and all Google Apps Script code untouched.

## Features
- Jamaica coastal landing page with responsive layout and no Instagram social icons
- Automatically displays `/instagram/generated/today.png`, with a fresh URL on page load
- Preserves Current, Tomorrow, Weekend and Fishing Banks forecast views with iframe popup-style loading overlay
- Fishing Intelligence and Catch Logs links
- Marine alert modal using existing JSONP service
- No new API calls for the poster; it loads the generated static PNG

## Notes
- Forecast endpoint uses the latest user-provided deployment URL.
- The provided hero image is the existing sunset photo from the Instagram folder; replace `assets/jamaica-sea-sunset.jpg` with a licensed Jamaica-specific photograph if desired.
- The image is the latest **published** PNG, not a guarantee that today's automated run succeeded; the graphic itself displays its forecast date.
- Browser/network/live deployment not tested in this offline package.
