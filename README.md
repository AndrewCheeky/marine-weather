Marine Weather — 15-second loading fallback

Replace index.html in the marine-weather GitHub repository root and commit to main.

The loading overlay starts immediately for the initial page and each forecast selection or Refresh. It disappears on a matching Apps Script ready signal, or automatically 15 seconds after the request begins if no signal is received. Switching views resets the 15-second timer. The iframe load event does not dismiss it.

No Apps Script or Cloudflare changes required.
