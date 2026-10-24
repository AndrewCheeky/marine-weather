import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const banks = JSON.parse(await readFile('banks/banks.json', 'utf8'));
const endpoint = process.env.MARINE_APP_URL || 'https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const periods = (process.env.BANK_PERIODS || 'tomorrow,current').split(',').filter(x => ['tomorrow','current'].includes(x));
const waitMs = Number(process.env.BANK_WAIT_MS || 30000);
const failurePattern = /exception:|script function not found|service unavailable|error loading|too many requests|access denied|authorization required|invalid bank|unknown bank|sign in|permission denied|page not found/i;
// Require forecast-related information; never publish loading pages or arbitrary HTML.
const forecastPattern = /(?:wind|gust|wave|seas|swell|forecast|marine|knots|\bkt\b|\bft\b)/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir('banks/generated', {recursive:true});
await mkdir('banks/diagnostics', {recursive:true});
const browser = await chromium.launch({headless:true});
let success=0, fail=0;
const report=[];
for (const b of banks) {
  if (!/^[a-z0-9_-]+$/.test(b.key)) continue;
  for (const when of periods) {
    const page = await browser.newPage({viewport:{width:1050,height:900},deviceScaleFactor:1});
    const label = `${b.key}-${when}`;
    const entry = {bank:b.key,period:when,frames:0,status:null,reason:'',textLength:0};
    try {
      const url = new URL(endpoint);
      url.searchParams.set('action','bank'); url.searchParams.set('key',b.key);
      url.searchParams.set('when',when); url.searchParams.set('popup','1'); url.searchParams.set('hideFooter','1');
      const response = await page.goto(url.toString(), {waitUntil:'domcontentloaded',timeout:90000});
      entry.status = response?.status() ?? null;
      if (entry.status && entry.status >= 400) throw Error(`Page returned HTTP ${entry.status}`);
      let selected = null;
      const started = Date.now();
      while (Date.now()-started < waitMs) {
        const frames = page.frames(); entry.frames = frames.length;
        for (const frame of frames) {
          try {
            const body = (await frame.locator('body').innerText({timeout:2000})).trim();
            entry.textLength = Math.max(entry.textLength,body.length);
            if (failurePattern.test(body) && body.length < 500) continue;
            if (body.length >= 90 && forecastPattern.test(body) && !/^(loading|please wait|redirecting)[.\s]*$/i.test(body)) {
              selected = frame; break;
            }
          } catch { /* frame may be navigating */ }
        }
        if (selected) break;
        await sleep(1500);
      }
      if (!selected) throw Error(`No recognizable forecast after ${waitMs/1000}s; ${entry.frames} frame(s), maximum body text ${entry.textLength} chars. Check action=bank, bank key, access and page rendering.`);
      // Screenshot the frame containing forecast, not an empty Apps Script wrapper.
      await selected.addStyleTag({content:'html,body{background:#f2f9fc!important;color:#07283b!important}body{max-width:980px!important;margin:0 auto!important;padding:24px!important;font-family:Arial,sans-serif!important}table{max-width:100%!important}*{overflow-wrap:break-word}'}).catch(()=>{});
      await sleep(700);
      const height = await selected.evaluate(()=>Math.min(6500,Math.max(700,document.documentElement.scrollHeight))).catch(()=>900);
      await page.setViewportSize({width:1050,height:Math.min(height,900)});
      const bodyLocator=selected.locator('body');
      const image=await bodyLocator.screenshot({type:'webp',quality:85,animations:'disabled',timeout:45000});
      if (image.length<8000) throw Error(`Rendered image too small (${image.length} bytes)`);
      const path=`banks/generated/${label}.webp`;
      await writeFile(path,image);
      console.log('PUBLISHED',path,image.length,'bytes'); success++;
      entry.reason='Published';
    } catch(e) {
      entry.reason=String(e.message).slice(0,400);
      console.error('SKIPPED',label,entry.reason); fail++;
    } finally {
      report.push(entry); await page.close();
    }
  }
}
await browser.close();
await writeFile('banks/diagnostics/latest.json',JSON.stringify({generatedAt:new Date().toISOString(),success,fail,results:report},null,2));
console.log(`Published ${success}, skipped ${fail}. Existing images preserved when individual captures fail.`);
if (!success) process.exitCode=1;
