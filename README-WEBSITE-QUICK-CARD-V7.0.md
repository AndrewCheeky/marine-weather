# v7.0 — Website quick-reference forecast card

- Removes the large MARINE WEATHER JAMAICA branding and Instagram tagline from the generated image; retains forecast date and window.
- Reduces the portrait PNG to 1080×1370, retaining the approved photographic design and icons.
- Displays up to two high tides and two low tides on separate lines instead of truncating them with an ellipsis.
- Shows per-bank comfort ratings when `poster.bank1comfort` and `poster.bank2comfort` are present in the verified JSONP payload.
- Shows moonrise and moonset when `poster.moonrise` and `poster.moonset` (or camel-case variants) are present; missing fields are displayed as a dash rather than invented.
- Keeps moon phase and illumination sourced from the existing payload.
- Keeps existing endpoint, verified-data requirements, 05:30/06:30 schedule, and preservation of previous images on failure.

## IMPORTANT: Data-source additions
The currently supplied Apps Script `mwInstagramPayload_` builds bank comfort scores internally as `b1.score` and `b2.score`, but does **not** include bank comfort, moonrise or moonset in the `poster` response. To populate bank comfort, add these entries to the existing `poster` object in Apps Script and redeploy:

```
bank1comfort: b1.score === null ? '—' : f(b1.score,1)+'/5',
bank2comfort: b2.score === null ? '—' : f(b2.score,1)+'/5',
```

For moonrise/moonset, add `moonrise` and `moonset` to the payload using existing *verified* astronomy values from your astronomy cache, formatted for Jamaica time. Do not fabricate or calculate them from the moon phase. Until these fields are supplied, the card displays a dash.

## Deploy
Upload this complete ZIP to your GitHub repository (or replace `scripts/generate-instagram-sharp.mjs` only); commit and manually run **Daily Marine Forecast PNG** to force regeneration of `instagram/generated/today.png`.

## Validation
Node syntax checked and archive verified. Live forecast and Sharp render were not available for verification in this environment.
