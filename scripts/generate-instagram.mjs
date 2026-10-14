import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const posterUrl = process.env.POSTER_URL || 'https://marine-weather.andrewcheeky.com/instagram/';
const outputDir = resolve(process.env.OUTPUT_DIR || 'instagram/generated');
const maxAttempts = 3;

function jamaicaDate(offset = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Jamaica', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ headless: true });
try {
  await mkdir(outputDir, { recursive: true });
  // Generate BOTH images, using separate pages so neither inherits the other's state.
  const results = [];
  for (const [day, offset] of [['today', 0], ['tomorrow', 1]]) {
    let success = false;
    for (let attempt = 1; attempt <= maxAttempts && !success; attempt++) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 1 });
      try {
        page.on('console', msg => { if (msg.type() === 'error') console.error(`[${day} browser]`, msg.text()); });
        await page.goto(posterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        // Selecting today triggers a fresh read; tomorrow is the template's default.
        if (day === 'today') await page.locator('#forecastDay').selectOption('today');
        await page.waitForFunction(() => window.__marinePosterReady === true && document.querySelector('#export')?.disabled === false, null, { timeout: 90000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.waitForFunction(() => {
          const img = document.querySelector('canvas#art');
          return img && img.width === 1080 && img.height === 1080;
        });
        const actualDate = await page.evaluate(() => window.__marinePosterDay);
        const expectedDate = jamaicaDate(offset);
        if (actualDate !== expectedDate) throw new Error(`Wrong forecast day: expected ${expectedDate}, received ${actualDate}`);
        const b64 = await page.locator('#art').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
        const png = Buffer.from(b64, 'base64');
        if (png.length < 100000) throw new Error('Image unexpectedly small; refusing to publish');
        results.push({ day, actualDate, png });
        console.log(`Prepared ${day}.png for ${actualDate} (${png.length} bytes)`);
        success = true;
      } catch (error) {
        console.error(`${day}: attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
        if (attempt === maxAttempts) throw new Error(`Unable to generate ${day}.png; existing published images will not be overwritten`);
      } finally {
        await page.close();
      }
    }
  }
  // Write only after both days succeeded; workflow commits only on full success.
  for (const { day, actualDate, png } of results) {
    await writeFile(resolve(outputDir, `${day}.png`), png);
    await writeFile(resolve(outputDir, `marine-weather-jamaica-${actualDate}.png`), png);
  }
  console.log('Created today.png and tomorrow.png successfully.');
} catch (error) {
  console.error('Publication aborted:', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
