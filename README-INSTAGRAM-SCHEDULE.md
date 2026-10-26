# Daily Instagram image scheduling and performance

- Primary scheduled run: **05:30 Jamaica time**, `30 10 * * *` UTC.
- Retry scheduled run: **06:30 Jamaica time**, `30 11 * * *` UTC.
- The retry skips browser setup and image generation when `instagram/generated/marine-weather-jamaica-YYYY-MM-DD.png` exists and is nonempty. This dated PNG is written by the existing generator after the page reports a matching Jamaica calendar date.
- If the primary run fails before committing the dated image, the retry attempts generation. A failed generation leaves the previous images untouched and the job fails.
- `actions/cache` reuses the Chromium browser download on warm cache hits. The workflow installs the Playwright npm package each required run.
- `npx playwright install chromium` runs only on cold browser caches. Unlike `--with-deps`, this assumes the GitHub-hosted `ubuntu-latest` runner already contains compatible browser system libraries. If a missing shared library error occurs, restore `npx playwright install --with-deps chromium` for cold-cache runs.
- GitHub scheduled workflows may start late or be dropped; the 06:30 retry is not a guarantee that an image will be published at 06:30.
- Both scheduled events run the same workflow on the default branch. Manual dispatch can be used for testing.
- No changes to Google Apps Script, the forecast data source, the PWA or the bank forecast generator.
