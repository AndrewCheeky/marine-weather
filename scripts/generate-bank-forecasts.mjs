import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const banks=JSON.parse(await readFile('banks/banks.json','utf8'));
const endpoint=process.env.MARINE_APP_URL||'https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const periods=(process.env.BANK_PERIODS||'tomorrow,current').split(',').filter(x=>['tomorrow','current'].includes(x));
await mkdir('banks/generated',{recursive:true});
const browser=await chromium.launch({headless:true});let success=0,fail=0;
for(const b of banks){if(!/^[a-z0-9_-]+$/.test(b.key))continue;
for(const when of periods){const page=await browser.newPage({viewport:{width:1050,height:900},deviceScaleFactor:1});
try{
 const url=endpoint+'?action=bank&key='+encodeURIComponent(b.key)+'&when='+when+'&popup=1&hideFooter=1';
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForTimeout(2500);
 const body=(await page.locator('body').innerText({timeout:15000})).trim();
 // Never publish an error, blank response, or provider diagnostic as a forecast image.
 if(body.length<140||/exception:|script function not found|service unavailable|error loading|too many requests|access denied|authorization required|invalid bank|unknown bank/i.test(body))throw Error('No validated forecast content');
 const actual=await page.locator('body').boundingBox();if(!actual)throw Error('Empty page');
 await page.addStyleTag({content:`body{max-width:980px!important;margin:0 auto!important;padding:24px!important;background:#f2f9fc!important;color:#07283b!important;font-family:Arial,sans-serif!important}table{max-width:100%!important}*{overflow-wrap:break-word}`});
 const h=Math.min(6000,Math.max(700,await page.evaluate(()=>document.documentElement.scrollHeight)));
 await page.setViewportSize({width:1050,height:Math.min(900,h)});
 const image=await page.screenshot({type:'webp',quality:83,fullPage:true,animations:'disabled',timeout:30000});
 if(image.length<8000)throw Error('Rendered image too small');
 const path=`banks/generated/${b.key}-${when}.webp`;
 await writeFile(path,image);console.log('PUBLISHED',path,image.length,'bytes');success++;
}catch(e){console.error('SKIPPED',b.key,when,String(e.message).slice(0,220));fail++}finally{await page.close()}
}}
await browser.close();console.log(`Published ${success}, skipped ${fail}. Existing images are preserved on failures.`);
if(!success)process.exitCode=1;
