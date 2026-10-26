# Instagram forecast graphic — v6.3

The daily GitHub Actions workflow uses Sharp to render a 1080×1350 portrait PNG directly from the **existing** verified `instagramData` spreadsheet endpoint. Chromium, Playwright, and the local web server are no longer used for this workflow. The existing browser-based Instagram Studio and old generator remain available for rollback/manual use.

- Primary schedule: 05:30 Jamaica; retry 06:30 Jamaica only if today's dated PNG is missing.
- Only `payload.ok`, `payload.ready`, `payload.stale`, `payload.missing` and `payload.day` are used to gate publication.
- Values are displayed only when supplied by the endpoint; no invented species, tides, fishing scores or conditions.
- Image file paths are unchanged (`instagram/generated/today.png` and dated image).
- This version intentionally uses a data-accurate interpretation of the design mockup, not the mockup's fabricated species/scores or illustrative forecast numbers.
- Deploy workflow + `scripts/generate-instagram-sharp.mjs`; manual Actions workflow_dispatch test. Check generated graphic visually on mobile before relying on it.
- No Google Apps Script or bank workflow changes.
