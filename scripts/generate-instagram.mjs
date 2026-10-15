import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const posterUrl = process.env.POSTER_URL || 'https://marine-weather.andrewcheeky.com/instagram/';
const outputDir = resolve(process.env.OUTPUT_DIR || 'instagram/generated');
const maxAttempts = 3;
const dateInJamaica = (offset = 0) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+offset);
  return d.toISOString().slice(0,10);
};

await mkdir(outputDir,{recursive:true});
const browser = await chromium.launch({headless:true});
let count=0;
try {
  for (const [day,offset] of [['today',0]]) {
    let created=false;
    for (let attempt=1; attempt<=maxAttempts && !created; attempt++) {
      const page=await browser.newPage({viewport:{width:1500,height:1200},deviceScaleFactor:1});
      try {
        page.on('console',m=>{if(m.type()==='error') console.error(`[${day} console] ${m.text()}`)});
        page.on('pageerror',e=>console.error(`[${day} pageerror] ${e.message}`));
        const response=await page.goto(posterUrl,{waitUntil:'domcontentloaded',timeout:60000});
        if (!response?.ok()) throw new Error(`Poster page HTTP ${response?.status()??'no response'}`);
        // The page automatically starts ONE forecast request on load.
        // Do not click Load again: that invalidates the first JSONP callback
        // and can cause a late-response 'callback is not defined' error.
        const selector=page.locator('#forecastDay');
        await selector.waitFor({timeout:15000});
        if (await selector.inputValue() !== day) await selector.selectOption(day);
        await page.waitForFunction(()=>window.__marinePosterReady===true && document.querySelector('#export')?.disabled===false,null,{timeout:75000});
        const actual=await page.evaluate(()=>window.__marinePosterDay);
        const expected=dateInJamaica(offset);
        if(actual!==expected) throw new Error(`Date mismatch: ${actual} != ${expected}`);
        const diagnostics=await page.evaluate(()=>({
          peakWind:document.querySelector('#peakWind')?.value||'',
          peakWave:document.querySelector('#peakWave')?.value||'',
          lowTides:document.querySelector('#lowTides')?.value||'',
          source:document.querySelector('#source')?.value||''
        }));
        console.log(`POSTER DATA ${day}: ${JSON.stringify(diagnostics)}`);
        for(const key of ['peakWind','peakWave','lowTides']){
          if(/unavailable|undefined|null/i.test(diagnostics[key]))
            throw new Error(`Placeholder detected in ${key}: ${diagnostics[key]}`);
        }
        await page.evaluate(()=>document.fonts.ready);
        const data=await page.locator('canvas#art').evaluate(c=>{if(c.width!==1080||c.height!==1080)throw Error('Unexpected canvas size');return c.toDataURL('image/png').split(',')[1]});
        const png=Buffer.from(data,'base64');
        if(png.length<100000)throw new Error(`PNG too small (${png.length} bytes)`);
        await writeFile(resolve(outputDir,`${day}.png`),png);
        await writeFile(resolve(outputDir,`marine-weather-jamaica-${actual}.png`),png);
        console.log(`SUCCESS ${day}.png: ${actual}, ${png.length} bytes`);
        count++;created=true;
      } catch(e) {
        const msg=await page.locator('#message').textContent().catch(()=>'(no page message)');
        console.error(`FAILED ${day}, attempt ${attempt}/${maxAttempts}: ${e.message}; poster says: ${msg}`);
        if(attempt<maxAttempts)await new Promise(r=>setTimeout(r,5000));
      } finally {await page.close();}
    }
    if(!created)console.error(`SKIPPED ${day}.png: forecast unavailable. Any existing PNG remains unchanged.`);
  }
} finally {await browser.close();}
console.log(`Generated ${count}/1 image.`);
if(count===0)process.exitCode=1;
