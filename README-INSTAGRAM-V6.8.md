# v6.8 — condition-responsive Jamaica sea imagery

Changes: `scripts/generate-instagram-sharp.mjs` selects a locally bundled header photo from `instagram/background-good.jpg`, `instagram/background-fair.jpg`, and `instagram/background-poor.jpg` according to the validated **overall** status: GREEN → good; AMBER/YELLOW → fair; RED → poor. Unknown status uses fair. Existing `sunset-background.jpg` remains the fallback. All forecast retrieval, validation, scheduling, PNG filenames, design geometry, and other site files are unchanged. The background assets are illustrative Jamaican-style seascapes, not current weather photography.

Replace the one script and add the three JPGs, preserving the folder paths. Trigger Actions → Daily Marine Forecast PNG → Run workflow to regenerate even if today's PNG exists.
