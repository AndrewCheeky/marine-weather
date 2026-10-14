import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.POSTER_URL || 'https://marine-weather.andrewcheeky.com/instagram/';
const day = process.env.FORECAST_DAY || 'tomorrow';
const out = process.env.OUTPUT_DIR || 'instagram/generated';
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1500,height:1200}, deviceScaleFactor:1});
  page.on('console', msg => { if(msg.type()==='error') console.error('[browser]',msg.text()); });
  await page.goto(base, {waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#forecastDay').selectOption(day);
  await page.waitForFunction(() => window.__marinePosterReady === true && document.querySelector('#export')?.disabled === false, {timeout:45000});
  await page.waitForFunction(() => { const img = document.querySelector('canvas#art'); return img && img.width===1080 && img.height===1080; });
  await page.evaluate(async()=>{ await document.fonts.ready; });
  const data = await page.locator('#art').evaluate(canvas=>canvas.toDataURL('image/png').split(',')[1]);
  const forecastDate = await page.evaluate(()=>window.__marinePosterDay);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(forecastDate))throw new Error('Missing validated forecast date');
  await mkdir(out,{recursive:true});
  const file=resolve(out,`marine-weather-jamaica-${forecastDate}.png`);
  const latest=resolve(out,'latest.png');
  const buffer=Buffer.from(data,'base64');
  if(buffer.length<100000)throw new Error('PNG unexpectedly small; refusing publication');
  await writeFile(file,buffer);await writeFile(latest,buffer);
  console.log(`Generated ${file} (${buffer.length} bytes) and ${latest}`);
} catch(err) { console.error('Forecast not published:',err.message);process.exitCode=1; }
finally { await browser.close(); }
