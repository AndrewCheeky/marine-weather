Instagram cache reader update

- Corrected status mapping: live script uses YELLOW; Instagram uses AMBER for the middle category.
- Handles cached day/hour cells formatted as text or spreadsheet dates.
- Corrected precipitation unit from mm/hr to mm (cached precipSumMm is a window total).
- Preserves original doGet dispatch, email, subscribers, API, and forecast functions.
- No additional API requests.
- Replace existing Apps Script with the integrated .gs file (do not paste both files together); save and redeploy the existing web app as a new version.
- Publish only instagram/, scripts/, .github/ to public GitHub. NEVER publish apps-script/ because the integrated file contains private configuration.
- This is a static code correction, not verified against live cache records.
