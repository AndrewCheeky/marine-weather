# Instagram direct-rendered forecast v6.5

- Uses the **existing Apps Script** `action=instagramData&day=today&callback=marineSharpCallback` contract, as the working Playwright-based Instagram Studio does.
- Parses JSONP **without evaluating JavaScript**; also accepts plain JSON if the service ever responds with that format. Unexpected HTML/callbacks fail safely.
- Requires `ok=true`, `ready=true`, `stale!=true`, no `missing` fields, a matching Jamaica date, and a poster object; never invents live forecast values.
- Preserves existing images on failure. `--preview` generates illustrative, non-live data only.
- 1080 × 1600 Sharp graphic; no Chromium or Playwright required for the scheduled workflow.
- Scheduled at 05:30 Jamaica time (10:30 UTC), with a 06:30 retry (11:30 UTC) if the dated PNG is absent; manual dispatch forces generation.
- Only the Sharp renderer and this README changed relative to v6.4. All other site files and workflows are retained.

## Test
`npm install --no-save sharp@0.34.4` then `node scripts/generate-instagram-sharp.mjs --preview` for the illustrative layout. For live data, run `node scripts/generate-instagram-sharp.mjs` in the GitHub workflow; verify the PNG visually after deployment.
