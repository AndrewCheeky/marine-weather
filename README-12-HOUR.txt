Marine Weather – 12-hour hourly popup display (v7.9.5)

Changed files only:
  assets/banks.js
  index.html
  sw.js

Upload these files to the same paths in the Marine Weather GitHub website repository.
Do NOT replace your Google Apps Script.

Current period now shows up to 12 consecutive hourly records, starting at the current Jamaica hour, including tomorrow when available.
Tomorrow remains 07:00–17:00 (11 records).
The published fallback may contain fewer than 12 records; existing partial-forecast notice remains.
No changes to refresh interval, API retrieval, snapshot format, forecast images or cache TTL.
Index and service-worker version strings are incremented solely to load the updated JavaScript.

Based on the last confirmed working website patch: MarineWeather-v7.9.4-From-Production-14.zip.
