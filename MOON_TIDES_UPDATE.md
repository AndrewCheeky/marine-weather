Moon and tides update
=====================
- Instagram poster displays calculated moon phase and illumination for the selected day.
- High and low tide times for Kingston / Maiden Cay are read from existing MarineCache tideExtremaJson values only. Two highs and two lows maximum; heights shown in feet when present.
- All tide times are Jamaica local time (24-hour clock). Unavailable means no valid cached extrema, not zero tide.
- No extra API calls or triggers.
- Moon calculation uses existing moonPhaseForDate fallback, without an external astronomy request.
- Existing safety note remains in the editable studio but is replaced on the 1080x1080 artwork by the moon/tides strip; NOT FOR NAVIGATION footer remains.
- Install ONLY the integrated Apps Script file, not InstagramData.gs separately.
- Update instagram/index.html on GitHub and redeploy Apps Script as a new version.
