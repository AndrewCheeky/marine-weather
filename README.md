# Marine Weather GitHub frontend — load-until-ready update

Upload `index.html` to the root of the `andrewcheeky/marine-weather` GitHub repository and commit.

The overlay now remains visible until the iframe `load` event, including initial load and every forecast switch. After 30 seconds the advisory text changes but the overlay does not disappear automatically.

**Technical limitation:** An iframe `load` event indicates that the embedded page finished its browser navigation, not necessarily that Google Apps Script completed all asynchronous data rendering. For exact data-ready detection, the GAS HTML must send a `postMessage` readiness event, which requires a coordinated backend change. The iframe can also fire `load` for certain error pages.

No Google Apps Script or Cloudflare changes are needed for this frontend-only improvement.
