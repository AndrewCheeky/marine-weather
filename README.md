# Marine Weather — GitHub Pages frontend

Upload `index.html` to the root of the `andrewcheeky/marine-weather` repository and commit to `main`. Enable GitHub Pages under Settings → Pages → Deploy from a branch → main → / (root).

Test at https://andrewcheeky.github.io/marine-weather/

## Loading animation
A centered spinning marine-blue loading indicator appears whenever you select Current, Tomorrow, Weekend, Fishing Banks, or Refresh. It disappears when the iframe load event fires. If loading takes more than 30 seconds, the page offers refresh/direct-open guidance. Note that iframe load does not guarantee the remote forecast loaded successfully; Google-controlled errors may still be displayed within the iframe.

The frontend retains the existing Google Apps Script deployment and does not change weather caches, scheduled emails, or subscriber data. Keep the Apps Script source and credentials private.
