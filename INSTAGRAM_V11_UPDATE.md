# Instagram v11 display correction

- Instagram page now uses the confirmed Apps Script deployment.
- Missing peaks and tide data are hidden (label and value), never rendered as Unavailable.
- Clears previously loaded values when a new response omits fields.
- No Google Apps Script changes, no additional forecast calls.
- GitHub Actions remains today-only.

Upload the changed `instagram/index.html` to your public repository (or replace with the complete archive). Run Daily Marine Forecast PNG via Actions and check `instagram/generated/today.png`. Old generated images are retained until the workflow successfully replaces them.

The website/Instagram peak-window mismatch is a separate forecast calculation issue, not corrected by this display-only patch.
