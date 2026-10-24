# Marine Weather Jamaica v4.6 — simplified landing page

This package removes the **four-card service highlight strip** and the entire **Know before you go / Current 6 Hours / Tomorrow / Weekend / Fishing Banks iframe panel** shown in the screenshot. The main hero, today’s image, 13-bank dropdown gallery, Fishing Intelligence/Logs, and automatic advisory popup remain.

## Install
Upload these files and folders to the root of `AndrewCheeky/marine-weather`, preserving `.github/workflows/`, and commit to `main`. Do not delete any existing generated images, Instagram output, `CNAME`, or unrelated files.

If you have newer changes in your live repository, merge `index.html` and `assets/landing.js` rather than overwriting those changes. The bundle uses v4.2 as its base, the v4.4 bank generator, and the v4.5 alert popup.

## Changed
- `index.html`: removes the two screenshot sections, redirects navigation/hero links to `#bank-snapshots`, retains bank dropdown and alert dialog.
- `assets/landing.js`: removes iframe startup and view navigation handlers that would error after the panel was removed; keeps Fishing Intelligence/Logs popup buttons and today’s image.
- Everything else remains as in the packaged baseline.

## Safety
The alert popup depends on the deployed GAS `action=marineAlert` endpoint; no GAS or subscriber email changes are included. Bank images depend on the existing workflow and valid bank pages. No live deployment test was performed.

## v4.7 — IrieFINS official application card
Added a fourth Explore Jamaica’s Waters card linking to https://iriefins.nfa.gov.jm/application-types with a teal file-check icon and the caption “Official fisheries applications and approvals”. The card uses the existing explore-card layout and responsive grid. No other website behavior or workflows changed.
