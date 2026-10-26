# Marine Weather Jamaica — v7.3

Clean GitHub Pages package. Upload the contents to the **root** of `AndrewCheeky/marine-weather`, preserving directory structure.

## Homepage forecast image fix

The `instagram/generated/today.png` forecast is displayed at its natural portrait aspect ratio; its full height, including the bottom safety panel, remains visible. The hero section expands with the image instead of cropping it. The stylesheet and service-worker versions were incremented to refresh old cached CSS.

## Cleanup

Removed duplicate root HTML, obsolete duplicate workflows and generator copies, test files, old documentation revisions and historical dated poster PNGs. Retained the active `.github/workflows/` actions, `scripts/` generators, website and Instagram pages, assets, bank images, latest dated poster, `today.png` and `tomorrow.png`, PWA files, CNAME and Google Apps Script reference.

No Google Apps Script deployment is needed. After committing, hard-refresh the site or reopen it to refresh the PWA cache.
