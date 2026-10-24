# Marine Weather Jamaica v5.3 — 14 banks + unified alignment

## Changes
- Added **Pigeion Island** as the 14th dropdown entry using the assumed GAS key `pigeion`.
- Corrected Morant Cays (`morant`) and Maiden Cay (`maiden`) identifiers.
- Aligned hero text, section headings, bank panel, four Explore cards, actions and footer to a common responsive content grid (48px desktop, 32px tablet, 20px mobile; max width 1400px).
- Preserved the v5.1 imagery, navigation, marine alert popup, forecast scripts, and GitHub Actions workflow.

## Installation
Extract into the root of the `marine-weather` GitHub repository, keeping folder structure, and commit to `main`. Do not delete other repository files or existing `banks/generated` images. Run **Cached Bank Forecast Images** to create Pigeion Island current/tomorrow images.

**Important:** `pigeion` is inferred from the supplied location name; confirm the actual key in your deployed Apps Script. If it differs, change only the `key` in `banks/banks.json`. The dropdown will appear immediately, but images will not appear until valid forecast pages are returned and the workflow commits them.
