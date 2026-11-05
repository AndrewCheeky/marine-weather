# Seven-day homepage image selection fix

Replace these files in the repository root:
- index.html
- assets/landing.js

The homepage now reads instagram/generated/seven-day-manifest.json and uses each manifest image path directly. It no longer rejects the entire manifest simply because the first date is not today or its generatedAt timestamp is over 24 hours old. It selects today's date if available, otherwise the next future date, otherwise the first listed date. The original today.png remains a fallback if the manifest is unavailable. The image URLs are versioned using the manifest generation timestamp.

Note: This fixes image selection only, not missing fields in the PNG artwork or whether the forecast itself is current. Inspect the date shown on the image before relying on the forecast.
