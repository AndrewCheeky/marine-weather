# Promote seven-day TEST to LIVE

Copy the included files into the same paths in the `marine-weather` GitHub repository. Do not delete the existing daily poster, live forecast or other workflows.

The scheduled `seven-day-outlook.yml` runs at 06:45 Jamaica, renders seven test posters using the standardized master-cache generator, validates all seven PNGs and their SHA-256 sidecars, then copies them to `instagram/generated/` and updates the live manifest. The homepage already reads that manifest and displays seven date buttons. Test and live now use the same renderer. The separate manual test workflow remains isolated.

**Prerequisite:** `SEVEN_DAY_DATA_URL` must point to a working Apps Script `action=marine7master` endpoint and return 98 validated records. The included generator retains its existing schema requirements; this promotion does not change production comfort scoring or Apps Script. If the endpoint uses v3 while this generator expects v4, the workflow will fail safely until the generator/feed are reconciled. No deployment or actual endpoint execution was performed.

Run the manual test workflow first, then `Seven-Day Marine Outlook` manually to publish. Confirm `instagram/generated/seven-day-manifest.json` has today's Jamaica date, and the live homepage shows seven buttons. Missing/stale feeds preserve the prior live files; the homepage falls back to its existing daily image.
