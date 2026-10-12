# Marine Weather GitHub Pages frontend

Upload `index.html` to the root of the `andrewcheeky/marine-weather` GitHub repository.

## Loading overlay fix
- Shows spinner immediately on first visit and each forecast selection.
- Ensures at least 1.4 seconds of visible loading state, even if an iframe fires an early load event.
- Defers iframe navigation by two animation frames to allow the overlay to paint.
- Retains the overlay until iframe load (or a 30-second timeout).
- Removes the Google Apps Script direct-forecast link and fallback paragraph.

No changes to the Google Apps Script backend or Cloudflare DNS are required.

Note: iframe `load` indicates that the embedded document has loaded, not necessarily that all internal forecast calculations have completed.
