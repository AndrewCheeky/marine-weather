# Website quick-reference card v7.1 — Apps Script data expansion

Deploy `APPS-SCRIPT-INSTAGRAM-DATA-v7.1.gs` as a **new version** of the existing Google Apps Script web app, preserving its existing deployment URL and access settings. This is based on the supplied working script and changes only the Instagram data payload.

New `poster` fields: `bank1comfort`, `bank2comfort`, `moonrise`, `moonset`. Bank scores use cached `comfortScore` values, while moonrise and moonset reuse `moonPhaseForDateAt()` and existing astronomy fallback; missing times remain blank. Existing highTides/lowTides remain unchanged.

The website card renderer already reads these four fields and displays up to two high and two low tide events on separate lines.

**Note:** The astronomy function can use the script's established astronomy cache/provider, so it is not guaranteed to be zero network requests; the forecast and bank figures continue to come from MarineCache.
