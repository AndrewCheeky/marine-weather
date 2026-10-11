# Jamaica Marine Outlook — frontend pilot

A static GitHub Pages/Cloudflare Pages pilot for `marine.andrewcheeky.com`, retaining the existing Google Apps Script backend and its scheduled emails. No provider API keys are placed in the browser.

## Important: required Apps Script adjustment

The current v3.8.5 Apps Script returns `HtmlService` pages **without** `setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)`. Google may therefore block embedding. In the Apps Script editor, add this helper:

```javascript
function marineEmbeddable_(output) {
  return output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

Then, inside `wxWebDispatchV383_`, wrap each `HtmlService.createHtmlOutput(...).setTitle(...)` return for the public actions `current`, `tomorrow`, `weekend`, `banks`, and `bank` with `marineEmbeddable_(...)`. Example:

```javascript
return marineEmbeddable_(
  HtmlService.createHtmlOutput(wxSynopsisShellV384b_(syn.html, '', banner))
    .setTitle('Current Marine Outlook')
);
```

Google's HTML-service sandbox and redirects may still impose limitations on iframe navigation and popups. This pilot is **not** a reverse proxy or fully independent platform. Test all four views, bank popups, mobile layout, and subscription links before promoting it.

**Security:** ALLOWALL removes Google's X-Frame-Options protection for these responses; only apply it to public non-sensitive pages. It allows third-party sites to embed them. Do not expose private data, admin pages, or tokens. Prefer a future JSON API and independently rendered frontend for stronger security and branding.

## Publish

1. Create a GitHub repository (e.g. `marine-outlook`), upload `index.html` and `README.md`.
2. Enable GitHub Pages under Settings → Pages, deploy from main branch/root.
3. Verify the GitHub Pages URL works before changing DNS.
4. For `marine.andrewcheeky.com`, add the GitHub Pages custom domain in GitHub first. Then create a Cloudflare DNS CNAME `marine` → `andrewcheeky.github.io` (DNS only during certificate issuance, if needed). Set the custom domain in Pages and wait for HTTPS certificate provisioning. Avoid an existing conflicting Worker route or CNAME.
5. Set HTTPS enforcement after GitHub reports a valid certificate.

**Alternative:** deploy `index.html` to Cloudflare Pages and attach the custom domain there; do not configure GitHub Pages and Cloudflare Pages to own the same hostname.

## Scope

This phase changes no scheduled refreshes, subscriber data, email sender, or forecasting logic. The Google Apps Script URL remains accessible in iframe links and browser network requests. Eliminating Google-branded experiences and script URLs requires a server-side API and a real frontend migration.
