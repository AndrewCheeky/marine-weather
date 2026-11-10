# Marine Weather Jamaica — v8.0

Website: https://marine.islandsoutside.com (GitHub Pages, custom domain in `CNAME`).

## How the site is put together

| Part | Where |
|---|---|
| Homepage | `index.html` + `assets/forecast.css`, `assets/mw-common.js`, `assets/outlook.js` (7-day outlook), `assets/banks.js` (bank map, charts, hourly table, live pop-up) |
| How-to-read page | `how-to-read.html` (rating rules, units, data sources, Open-Meteo credit) |
| Shared footer | `assets/shared-footer.js` / `.css` (also embedded on other andrewcheeky.com sites) |
| Offline / app install | `sw.js`, `manifest.webmanifest`, `assets/pwa.js` |
| Bank list | `banks/banks.json` (key + display name). Map coordinates: `banks/locations.json`, refreshed from the Google Sheet's `banks` tab (key, name, lat, lon) by the bank workflow |
| Poster generators | `scripts/generate-instagram-sharp.mjs` (today / tomorrow), `scripts/generate-seven-day.mjs` (7-day). Shared rating helpers: `scripts/status-summary.mjs` |
| Apps Script reference copy | `APPS-SCRIPT-INSTAGRAM-DATA-v7.1.gs` — keep this in sync with what is actually deployed |

### Ratings
`GREEN` = GOOD, `AMBER`/`YELLOW` = CAUTION, `RED` = ALERT. The inshore (Kingston / Maiden Cay) and offshore bank ratings are shown separately. Day buttons and the poster headline show the **worst** rating, so a green Kingston rating never hides an offshore alert.

## Generated files live on the `data` branch

Posters, bank images and hourly JSON are **not** committed to `main`. Every generator workflow:

1. runs `scripts/data-branch.sh restore` to load the latest generated files,
2. generates new ones,
3. runs `scripts/data-branch.sh publish …` to replace them on the `data` branch.

The `data` branch always holds a single commit with no history, so the repository no longer grows every day. Only the last 14 dated daily posters are kept.

The **Deploy website** workflow (`.github/workflows/deploy-pages.yml`) combines `main` + `data` with `scripts/build-site.mjs`, makes WebP copies of the posters, and publishes to GitHub Pages. It runs on every push to `main` and after every generator run. On its first run it creates the `data` branch automatically from the last version of `main` that still had the files.

**Requirement:** Settings → Pages → Build and deployment → Source must be **GitHub Actions**.

## Secrets and settings

| Name | Where | Used by |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GitHub → Settings → Secrets → Actions | bank and pilot workflows (read-only Sheets access) |
| `SEVEN_DAY_DATA_URL` | GitHub Actions secret | seven-day workflows |
| `VISUAL_CROSSING_KEY` | Apps Script → Project Settings → Script Properties | Apps Script fallback weather + astronomy. **Never put the key in source code.** |
| `BANKS_SHEET_ID`, `BANKS_SHEET_TAB` | optional workflow env | only if bank coordinates live in a different sheet or tab than `Forecast24h` |

## Testing a change before it goes live

Work on a branch, then either run the site locally (`python3 -m http.server` in a folder built with `node scripts/build-site.mjs` after `bash scripts/data-branch.sh restore`), or publish the branch to a separate beta repository/subdomain. The footer and all paths are relative, so a copy works on any host.

## Updating static files

When changing CSS or JS, bump the `?v=` query in `index.html` / `how-to-read.html` and the matching entries plus `VERSION` in `sw.js`, so installed phones pick up the change.
