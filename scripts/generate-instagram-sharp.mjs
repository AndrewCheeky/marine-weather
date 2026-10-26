import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

// Direct SVG → Sharp renderer. Uses the SAME verified spreadsheet-backed instagramData payload.
const endpoint=process.env.INSTAGRAM_DATA_URL || 'https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const out=resolve(process.env.OUTPUT_DIR||'instagram/generated');
const jamaicaDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const valid=v=>v!==null&&v!==undefined&&String(v).trim()&&!/^(unavailable|n\/a|undefined|null|—|-)$/i.test(String(v).trim());
const val=(d,k,f='—')=>valid(d[k])?String(d[k]):f;
const truncate=(v,n=28)=>String(v).length>n?String(v).slice(0,n-1)+'…':String(v);
const label=(x,y,t,size=22,color='#102c49',weight=700,extra='')=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" ${extra}>${esc(t)}</text>`;
const rect=(x,y,w,h,fill,r=14,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const theme=s=>s==='GREEN'?['#0c984b','#e5f7e8','GOOD']:s==='RED'?['#bf3434','#fff0ef','CAUTION']:['#c68a08','#fff6d6','FAIR'];
async function getForecast(){
  const cb='marineSharpCallback';
  const url=new URL(endpoint);url.searchParams.set('action','instagramData');url.searchParams.set('day','today');url.searchParams.set('callback',cb);
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),45000);
  try {
    const response=await fetch(url,{signal:ac.signal,headers:{'Accept':'text/javascript'}});
    if(!response.ok)throw Error('Forecast service did not respond successfully');
    const body=(await response.text()).trim();
    const match=body.match(/^marineSharpCallback\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/);
    if(!match)throw Error('Unexpected forecast response format');
    const data=JSON.parse(match[1]);
    if(!data?.ok||data.ready!==true||data.stale===true||(data.missing?.length??0)>0)throw Error('Forecast is not verified and current; preserving existing PNG');
    if(data.day!==jamaicaDay())throw Error(`Forecast day ${data.day} does not match Jamaica date ${jamaicaDay()}`);
    return data;
  } finally {clearTimeout(timer)}
}
function makeSvg(p){
 const d=p.poster||{};const [sc,sl,word]=theme(val(d,'status','AMBER'));
 const bank=(x,n)=>{const s=val(d,`bank${n}status`,'AMBER'),[c,b,w]=theme(s);return `<g>${rect(x,690,500,288,'#ffffff',19)}${rect(x,690,500,59,'#07477a',19)}${label(x+19,728,truncate(val(d,`bank${n}`),24),26,'#fff',800)}${rect(x+18,765,464,54,b,11)}${label(x+32,801,w,27,c,900)}${label(x+20,849,'BANK OUTLOOK',17,'#56728b',800)}${label(x+20,882,truncate(val(d,`bank${n}detail`),35),22,'#0c2944',700)}${label(x+20,919,'RAIN / CONDITIONS',17,'#56728b',800)}${label(x+20,952,truncate(val(d,`bank${n}rain`),39),21,'#0c2944',650)}</g>`};
 const cell=(x,y,top,bottom)=>`${label(x,y,top,18,'#55718a',800)}${label(x,y+41,truncate(bottom,18),30,'#0a3455',850)}`;
 const bg=rect(0,0,1080,1350,'#eaf3f8',0);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#067eb6"/><stop offset="1" stop-color="#033956"/></linearGradient></defs>${bg}${rect(0,0,1080,327,'url(#sky)',0)}${rect(0,235,1080,92,'#032c49',0,'opacity=".65"')}${label(34,68,'MARINE WEATHER',57,'#fff',900)}${label(34,147,'JAMAICA',91,'#ffce34',900)}${label(38,197,'FISHING  •  BOATING  •  EXPLORING',25,'#e4f7ff',700)}${label(38,285,`FORECAST  ${p.day}  |  07:00–17:00 JAMAICA`,26,'#fff',750)}${rect(20,346,1040,305,'#ffffff',20)}${label(46,393,'OVERALL MARINE CONDITIONS',28,'#113958',900)}${rect(45,413,315,80,sl,14)}${label(68,469,word,46,sc,900)}${label(390,445,truncate(val(d,'condition'),37),24,'#174b70',700)}${label(390,483,`Comfort: ${val(d,'comfort')}`,23,'#174b70',700)}<line x1="45" y1="518" x2="1030" y2="518" stroke="#d2e0e9" stroke-width="2"/>${cell(52,550,'WIND / GUSTS',[val(d,'wind'),val(d,'gust')].filter(v=>v!=='—').join(' / ')||'—')}${cell(380,550,'SEAS',val(d,'seas'))}${cell(700,550,'RAIN',val(d,'rain'))}${label(47,680,'FISHING BANKS  ·  QUICK COMPARE',29,'#0a3557',900)}${bank(20,1)}${bank(560,2)}${rect(20,997,1040,187,'#ffffff',20)}${label(45,1042,'MORE CONDITIONS',27,'#0a3557',900)}${cell(46,1073,'CURRENT',`${val(d,'current')} ${val(d,'currentDir','')}`)}${cell(382,1073,'SEA TEMPERATURE',val(d,'sst'))}${cell(748,1073,'UV INDEX',val(d,'uv'))}${rect(20,1200,1040,130,'#052d4b',18)}${label(45,1244,'FORECAST GUIDANCE ONLY',29,'#ffce34',900)}${label(45,1283,'Check official marine advisories before departure.',21,'#ffffff',650)}${label(45,1312,'Not for navigation.  •  marine-weather.andrewcheeky.com',19,'#c7e7f4',600)}</svg>`;
}
await mkdir(out,{recursive:true});
let last;
for(let attempt=1;attempt<=3;attempt++){
 try{
  const payload=await getForecast();const png=await sharp(Buffer.from(makeSvg(payload))).png({compressionLevel:8}).toBuffer();
  if(png.length<20000)throw Error('Rendered PNG unexpectedly small');
  await writeFile(resolve(out,`marine-weather-jamaica-${payload.day}.png`),png);
  await writeFile(resolve(out,'today.png'),png);
  console.log(`SUCCESS: ${payload.day}, ${png.length} bytes, Sharp 1080x1350, verified cached forecast`);process.exit(0);
 }catch(e){last=e;console.error(`Attempt ${attempt}/3: ${e.message}`);if(attempt<3)await new Promise(r=>setTimeout(r,2500));}
}
console.error('Forecast graphic not regenerated; existing PNG preserved.',last?.message);process.exit(1);
