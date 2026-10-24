# Marine Weather Jamaica v5.9 — centrally hosted shared footer

The Explore Jamaica’s Waters photo cards, two buttons, closing brand message and site footer now render from one centrally hosted JavaScript component, with its own scoped CSS. No Cloudflare or CORS changes required.

## Main site installation
Copy `index.html`, `assets/landing.js`, `assets/shared-footer.js`, `assets/shared-footer.css` and the existing supporting assets to the `marine-weather` repository. Preserve your existing scripts, bank images and GitHub Actions. Commit to main.

## Other subdomains
Place this near the end of each HTML page (before `</body>`):

```html
<div id="marine-shared-footer"></div>
<script src="https://marine-weather.andrewcheeky.com/assets/shared-footer.js?v=5.9" defer></script>
```

No extra stylesheet is required: the component loads `shared-footer.css` from the same central host into a Shadow DOM. Other subdomains must add the two lines once, but subsequent footer updates require only a change to the central script and stylesheet (subject to caching). The central assets and photographs must remain publicly accessible.

### Notes
- The Bank forecasts card uses the absolute Marine Weather URL so it works on every subdomain.
- Fishing Intelligence navigates in the same tab; Fishing Logs preserves popup behavior.
- CSS is isolated using Shadow DOM to avoid conflicts with subdomain page styles.
- If another page uses Content Security Policy, it must allow scripts/styles from marine-weather.andrewcheeky.com; no Cloudflare configuration is otherwise necessary.
- Test the deployed page and subdomains before rolling out broadly; no live deployment was performed.
