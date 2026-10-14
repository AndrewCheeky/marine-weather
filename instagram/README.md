# Marine Weather Jamaica — Instagram Forecast Studio

## What this does
A self-contained HTML editing tool that overlays a daily marine forecast on the supplied original sunset photograph. Exports a **1080 × 1080 PNG** for Instagram feeds. No installation, accounts, external libraries, or API keys required.

## How to use
1. Unzip the folder, keeping `index.html` and `sunset-background.jpg` in the same directory.
2. Open `index.html` in a modern browser (Chrome or Edge recommended).
3. Replace all **illustrative** sample figures with your verified forecast data. Update date, location, status, fishing bank details, and safety notice.
4. Click **Download Instagram PNG** and post the exported image.

## JSON input
Paste a JSON object in the JSON box, then click **Apply JSON**. Field names match the form inputs. Example:

```json
{
  "date": "Wednesday, 14 October 2026",
  "location": "KINGSTON · MAIDEN CAY",
  "status": "GREEN",
  "comfort": "4/5",
  "wind": "8 kt",
  "gust": "14 kt",
  "seas": "2.2 ft",
  "bank1status": "AMBER"
}
```

## Connecting live forecasts later
The current version intentionally does **not** call your Apps Script service, since the exact API response format and endpoint for a social-media export are not yet specified. A future integration can map a dedicated JSON forecast response to the input keys and generate the image on demand. Do not publish the sample values as an actual forecast.

## Notes
- Original user-provided photograph is included unchanged as `sunset-background.jpg`.
- No Google Apps Script or GitHub repository changes are required for the local editor.
- The PNG is rendered in the browser using HTML Canvas, not a screenshot.
- Not for navigation. Check official marine warnings before departure.
