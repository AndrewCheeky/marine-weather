# Seven-day TEST update: Kingston comfort-colour selector

Upload only these two files to their exact GitHub paths:

- `scripts/generate-seven-day-poster.mjs` (replace existing isolated test generator)
- `instagram/seven-day-test/index.html` (new isolated preview page)

Run **Actions > Seven-Day Poster TEST (isolated) > Run workflow**. The existing test workflow will commit generated PNGs and `instagram/seven-day-test/manifest.json`, now including each day’s Kingston provisional `status` and `comfort`.

Open `https://<your-github-pages-domain>/marine-weather/instagram/seven-day-test/` (or the equivalent URL for your custom-domain site) to preview the seven buttons and selected poster. No changes to the live landing page, today.png, tomorrow.png, live poster generator, or production workflow.

Buttons: GREEN, YELLOW, RED from the provisional Kingston classification; GREY when unavailable. The short-range / extended category appears beneath the day buttons and is no longer drawn on the PNG.

Important: These scores remain PROVISIONAL until thunderstorm, squall, and other production safety inputs are verified. Do not use test images for navigation or operational departure decisions.
