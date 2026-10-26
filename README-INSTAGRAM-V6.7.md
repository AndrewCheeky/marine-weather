# Instagram Sharp v6.7 — match working browser request

Only existing runtime file modified: `scripts/generate-instagram-sharp.mjs`.

- Uses the exact JSONP callback naming pattern of the working `instagram/index.html`: `mwInstagramCallback_<timestamp>_1`.
- Sends `action=instagramData`, `day=today`, `callback=<generated name>` in that order.
- Uses `Accept: */*`, consistent with a browser script request, instead of forcing a JavaScript/JSON Accept header.
- Keeps strict JSONP parsing, verified forecast checks, three attempts, and existing PNG protection.
- Includes the existing Instagram Studio solar-time fallback for missing sunrise/sunset fields (no change to the poster layout).
- Reports known, short, non-sensitive error messages in private GitHub Actions logs while redacting unrecognized responses.

**Install:** Replace the file above in your GitHub repository or upload the full ZIP contents at repository root, commit, then run **Actions → Daily Marine Forecast PNG → Run workflow**. The 05:30 and 06:30 Jamaica schedules are unchanged.

**Note:** Callback mismatch is a hypothesis; successful production data retrieval must be confirmed by a workflow run. The local checks verify JavaScript syntax and archive integrity, not live API behavior.
