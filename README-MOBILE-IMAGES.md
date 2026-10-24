# v6.0 — Mobile-readable bank forecast images

Changes only `scripts/generate-bank-forecasts.mjs` from v5.9: capture width 760px (was 1050px), larger text, headings, table cells and better spacing; output filenames remain `banks/generated/<key>-<period>.webp`. No changes to Google Apps Script, the website, bank identifiers, shared footer or GitHub workflow.

Install by replacing **only** `scripts/generate-bank-forecasts.mjs` in your existing GitHub repository, committing to `main`, then running Actions → Cached Bank Forecast Images → Run workflow. The workflow regenerates 28 images for 14 locations and two periods; confirm the rendered output visually, particularly dense tables. Successful outputs are committed; failed images remain unchanged. The output may be taller and have slightly larger file sizes.
