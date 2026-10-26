# v6.6 — Forecast response diagnostics (narrow patch)

Only `scripts/generate-instagram-sharp.mjs` is changed from v6.5; this README is new. No workflow, site, GAS, PWA, or bank forecast changes.

On the next manual **Daily Marine Forecast PNG** workflow run, inspect **Generate today’s PNG directly (no browser)** and find `FORECAST RESPONSE ENVELOPE`. It reports only status, content type, byte length, structural format, callback function name, and final host — never the raw response, URL query parameters, API secrets, or subscriber data.

If format is `HTML`, check that the deployed endpoint is accessible to GitHub runners and returns forecast data rather than an access/sign-in page. If `JSONP callback`, check `callbackName` against `marineSharpCallback`. If `JSON object`, the parser should accept it. If parsing succeeds but validation fails, use the specific validation message to correct the data mapping without weakening freshness rules. Existing PNGs remain untouched on failure.

Schedule remains 05:30 Jamaica and conditional 06:30 retry. Manually dispatched runs still force regeneration.
