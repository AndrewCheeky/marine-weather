# Marine Weather Jamaica — v7.3

Clean GitHub Pages package. Upload the contents to the **root** of `AndrewCheeky/marine-weather`, preserving directory structure.

## Homepage forecast image fix

The `instagram/generated/today.png` forecast is displayed at its natural portrait aspect ratio; its full height, including the bottom safety panel, remains visible. The hero section expands with the image instead of cropping it. The stylesheet and service-worker versions were incremented to refresh old cached CSS.

## Cleanup

Removed duplicate root HTML, obsolete duplicate workflows and generator copies, test files, old documentation revisions and historical dated poster PNGs. Retained the active `.github/workflows/` actions, `scripts/` generators, website and Instagram pages, assets, bank images, latest dated poster, `today.png` and `tomorrow.png`, PWA files, CNAME and Google Apps Script reference.

No Google Apps Script deployment is needed. After committing, hard-refresh the site or reopen it to refresh the PWA cache.


## v7.4 — GS-owned data and full background
- Deploy `APPS-SCRIPT-INSTAGRAM-DATA-v7.4.gs` in Apps Script and publish a new web-app version; preserve existing deployment access settings.
- Moon phase, one-decimal illumination, moonrise and moonset are taken from the same GS astronomy result for the Jamaica forecast date. Missing events remain unavailable.
- GS now returns `freshness: Current | Delayed`, `poster.freshness` and `poster.lastSuccessfulUpdate`, based on the existing 24-hour stale threshold. Delayed forecasts do not overwrite the existing daily image.
- The Sharp generator no longer calculates sunrise/sunset, no longer guesses illumination, and uses translucent panels to reveal the selected condition background.
- Replace the repository files with this package and delete the old `APPS-SCRIPT-INSTAGRAM-DATA-v7.1.gs` if present.
- **Note:** Existing website/email routes have not been rewritten to show the new status; they can adopt the GS-owned status after validating their current response schema.
