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
const label=(x,y,t,size=22,color='#102c49',weight=700,extra='')=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="Arial, DejaVu Sans, sans-serif" ${extra}>${esc(t)}</text>`;
const rect=(x,y,w,h,fill,r=14,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const theme=s=>s==='GREEN'?['#0c984b','#e5f7e8','GOOD']:s==='RED'?['#bf3434','#fff0ef','CAUTION']:['#c68a08','#fff6d6','FAIR'];
// Inspect only the response envelope, never log response bodies, query strings or data.
function describeResponse(body, contentType, status, finalUrl) {
  const s=String(body).replace(/^\uFEFF/, '').trim();
  const callbackMatch=s.match(/^(?:\/\*[\s\S]*?\*\/\s*)?([A-Za-z_$][\w$]*)\s*\(/);
  const type=s.startsWith('{')?'JSON object':s.startsWith('[')?'JSON array':callbackMatch?'JSONP callback':/^<!doctype html|^<html|^</i.test(s)?'HTML':s.length?'other text':'empty';
  let finalHost='unknown';
  try { finalHost=new URL(finalUrl).hostname; } catch {}
  return {status,contentType:(contentType||'unknown').split(';')[0],bytes:Buffer.byteLength(s),format:type,callbackName:callbackMatch?.[1]||'(none)',finalHost};
}
export function parseForecastResponse(body, callback) {
  const source=String(body).replace(/^\uFEFF/, '').trim();
  if (source.startsWith('{')) return JSON.parse(source);
  // Accept only a single JSONP function call; never execute JavaScript.
  const match=source.match(/^(?:\/\*[\s\S]*?\*\/\s*)?([A-Za-z_$][\w$]*)\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/);
  if (!match) throw Error('Response is neither a JSON object nor a single JSONP callback');
  if (match[1] !== callback) throw Error(`JSONP callback mismatch (received ${match[1]})`);
  return JSON.parse(match[2]);
}
function validateForecast(data) {
  if (!data || typeof data!=='object' || data.ok!==true) throw Error('Forecast service returned an unsuccessful result');
  if (data.ready!==true || data.stale===true || (Array.isArray(data.missing)&&data.missing.length>0))
    throw Error('Forecast is not verified and current; existing PNG preserved');
  const expected=jamaicaDay();
  if (data.day!==expected) throw Error(`Forecast date mismatch: received ${data.day||'unknown'}, expected ${expected}`);
  if (!data.poster || typeof data.poster!=='object') throw Error('Forecast response has no poster fields');
  const d=data.poster;
  // Match the established poster's required checks without fabricating missing values.
  for (const key of ['peakWind','peakWave','lowTides']) {
    if (/unavailable|undefined|null/i.test(String(d[key]??''))) throw Error(`Forecast contains placeholder in ${key}`);
  }
  return data;
}
async function getForecast(){
  // Match the callback naming convention of the proven browser-based Instagram Studio.
  const cb=`mwInstagramCallback_${Date.now()}_1`;
  const url=new URL(endpoint);url.searchParams.set('action','instagramData');url.searchParams.set('day','today');url.searchParams.set('callback',cb);
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),65000);
  try {
    const response=await fetch(url,{signal:ac.signal,headers:{Accept:'*/*'}});
    const body=await response.text();
    const details=describeResponse(body,response.headers.get('content-type'),response.status,response.url);
    // Private GitHub Actions logs only: no response contents, URLs or subscriber data.
    console.log('FORECAST RESPONSE ENVELOPE:',JSON.stringify(details));
    if(details.bytes<=64 && details.format==='other text'){
      // Only log a restricted class of known error messages; never log arbitrary response text.
      const message=body.trim();
      if(/^(invalid callback|unauthorized|forbidden|not found|bad request|access denied|error)$/i.test(message))
        console.error('FORECAST SHORT RESPONSE:',message);
      else console.error('FORECAST SHORT RESPONSE: unrecognized short text (redacted)');
    }
    if(!response.ok)throw Error(`Forecast service request failed (status ${response.status})`);
    let data;
    try { data=parseForecastResponse(body,cb); }
    catch(e) { throw Error(`Forecast response parse failed: ${e.message}; format=${details.format}, type=${details.contentType}`); }
    return validateForecast(data);
  } finally {clearTimeout(timer)}
}

// Same local solar fallback as instagram/index.html; used only for missing solar fields.
function marineSolarTimes(dayIso, lat=17.9085229, lon=-76.8103697) {
  const midnight=Date.parse(dayIso+'T00:00:00Z');
  if(!Number.isFinite(midnight))return {sunrise:'',sunset:''};
  const DEG=Math.PI/180,jd=midnight/86400000+2440587.5;
  const norm=x=>((x%360)+360)%360;
  function position(t){
    const L=norm(280.46646+t*(36000.76983+0.0003032*t));
    const M=norm(357.52911+t*(35999.05029-0.0001537*t));
    const e=0.016708634-t*(0.000042037+0.0000001267*t);
    const C=(1.914602-t*(0.004817+0.000014*t))*Math.sin(M*DEG)+(0.019993-0.000101*t)*Math.sin(2*M*DEG)+0.000289*Math.sin(3*M*DEG);
    const omega=125.04-1934.136*t,lambda=L+C-0.00569-0.00478*Math.sin(omega*DEG);
    const epsilon0=23+(26+(21.448-t*(46.815+t*(0.00059-t*0.001813)))/60)/60;
    const epsilon=epsilon0+0.00256*Math.cos(omega*DEG);
    const decl=Math.asin(Math.sin(epsilon*DEG)*Math.sin(lambda*DEG));
    const y=Math.tan(epsilon*DEG/2)**2;
    const eq=4/DEG*(y*Math.sin(2*L*DEG)-2*e*Math.sin(M*DEG)+4*e*y*Math.sin(M*DEG)*Math.cos(2*L*DEG)-0.5*y*y*Math.sin(4*L*DEG)-1.25*e*e*Math.sin(2*M*DEG));
    return {decl,eq};
  }
  function event(rise){
    let minutes=rise?660:1320;
    for(let i=0;i<8;i++){
      const {decl,eq}=position((jd+minutes/1440-2451545)/36525);
      const cosH=(Math.cos(90.833*DEG)-Math.sin(lat*DEG)*Math.sin(decl))/(Math.cos(lat*DEG)*Math.cos(decl));
      if(cosH < -1 || cosH > 1)return '';
      const H=Math.acos(Math.max(-1,Math.min(1,cosH)))/DEG;
      const next=720-4*(lon+(rise?H:-H))-eq;
      if(Math.abs(next-minutes)<0.0001){minutes=next;break;}
      minutes=next;
    }
    return new Intl.DateTimeFormat('en-US',{timeZone:'America/Jamaica',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(midnight+Math.round(minutes)*60000));
  }
  return {sunrise:event(true),sunset:event(false)};
}
function makeSvg(p){
 const d={...p.poster};
 const solar=marineSolarTimes(p.day);
 for(const key of ['sunrise','sunset'])if(!valid(d[key]))d[key]=solar[key];
 const W=1080,H=1600;
 const navy='#03263e',deep='#041c30',cyan='#25c8f1',yellow='#ffdf28',white='#fff';
 const [statusColor,,statusWord]=theme(val(d,'status','AMBER'));
 const overall=String(val(d,'status','AMBER')).toUpperCase();
 const backgroundKey=overall==='GREEN'?'good':overall==='RED'?'poor':'fair';
 const photo=globalThis.__marineConditionPhotos?.[backgroundKey]||globalThis.__marineHeaderPhoto||'';
 const t=(x,y,value,size=24,color=white,weight=700,extra='')=>label(x,y,value,size,color,weight,extra);
 const rr=(x,y,w,h,c,r=18,extra='')=>rect(x,y,w,h,c,r,extra);
 const image=(src,x,y,w,h,opacity=1)=>src?`<image href="${src}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>`:'';
 const icon=(name,x,y,size=42,color=cyan)=>{
  const paths={wind:'M3 8h15a4 4 0 0 0-4-4 M2 13h20a3 3 0 1 1-3 3 M4 18h10a3 3 0 1 1-3 3',wave:'M2 15c4-7 8-7 12 0s8 7 12 0 M2 22c4-7 8-7 12 0s8 7 12 0',rain:'M7 17a6 6 0 0 1 1-12 8 8 0 0 1 15 4 5 5 0 0 1-1 10H7 M9 23l-2 5 M17 23l-2 5 M25 23l-2 5',sun:'M16 4v5 M16 23v5 M4 16h5 M23 16h5 M7.5 7.5l3.5 3.5 M21 21l3.5 3.5 M24.5 7.5L21 11 M11 21l-3.5 3.5 M16 11a5 5 0 1 0 0 10 5 5 0 0 0 0-10',tide:'M2 12q7-8 14 0t14 0 M2 21q7-8 14 0t14 0',current:'M6 16h20 M19 9l7 7-7 7 M16 3a13 13 0 1 0 0 26',thermo:'M12 5a4 4 0 0 1 8 0v15a7 7 0 1 1-8 0z M16 10v15',compass:'M16 2l5 13-5 15-5-15z',warn:'M16 3L2 29h28z M16 12v8 M16 25v1',target:'M16 2v6 M16 24v6 M2 16h6 M24 16h6 M16 9a7 7 0 1 0 0 14 7 7 0 0 0 0-14'};
  return `<g transform="translate(${x} ${y}) scale(${size/32})" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]||paths.wave}"/></g>`;
 };
 const panel=(x,y,w,h)=>rr(x,y,w,h,'#042a43',18,'stroke="#b6f5ff" stroke-width="2"');
 const top=(x,y,w,title)=>`${rr(x,y,w,48,'#04243c',13)}${t(x+18,y+33,title,24,white,900)}`;
 const line=(x,y,w)=>`<path d="M${x} ${y}h${w}" stroke="#4db8d1" stroke-width="2"/>`;
 const info=(x,y,ic,title,value,sub='',w=160)=>`${icon(ic,x,y-35,39)}${t(x+48,y-15,title,17,'#bdefff',800)}${t(x+48,y+17,truncate(value,18),25,white,850)}${sub?t(x+48,y+41,truncate(sub,22),16,'#ccecf6',600):''}`;
 const bank=(x,n,focus)=>{
  const [c,,word]=theme(val(d,`bank${n}status`,'AMBER'));
  const name=truncate(val(d,`bank${n}`,'FISHING BANK'),28).toUpperCase();
  const picture=globalThis.__marineArt?.[focus]||'';
  const detail=val(d,`bank${n}detail`);
  const rain=val(d,`bank${n}rain`);
  return `${panel(x,710,506,413)}${image(picture,x+3,763,500,355)}
   <rect x="${x+3}" y="762" width="500" height="356" fill="url(#bankShade)"/>
   ${top(x+3,713,500,name)}
   ${rr(x+331,774,156,52,c,13)}${t(x+409,810,word,29,white,900,'text-anchor="middle"')}
   ${icon('target',x+22,938,36,white)}${t(x+71,953,focus==='pelagic'?'PELAGIC FOCUS':'BOTTOM / REEF FOCUS',19,'#d8f7ff',850)}
   ${t(x+71,979,focus==='pelagic'?'Tuna · Wahoo · Dolphin':'Snapper · Grouper · Reef fish',18,white,650)}
   ${icon('wave',x+22,995,36,'#a7efff')}${t(x+71,1014,'CONDITIONS',18,'#b6ecff',850)}
   ${t(x+71,1040,truncate(detail,32),19,white,650)}
   ${icon('rain',x+22,1053,36,'#56d7ff')}${t(x+71,1071,'RAIN / OUTLOOK',18,'#b6ecff',850)}
   ${t(x+71,1097,truncate(rain,32),19,white,650)}`;
 };
 const high=val(d,'highTides'),low=val(d,'lowTides');
 const moon=val(d,'moonPhase'),illum=val(d,'moonIllum');
 const moonPhase=moon.toLowerCase();
 // Draw a phase-aware moon: bright disc + masked dark portion; labels remain data-driven.
 const moonMask=moonPhase.includes('new')?0.03:moonPhase.includes('full')?1:Math.max(0.05,Math.min(0.95,(parseFloat(illum)||50)/100));
 const waxing=moonPhase.includes('waxing')||moonPhase.includes('first');
 const darkW=120*(1-moonMask);
 const moonArt=`<circle cx="916" cy="1216" r="66" fill="#e4e5d5"/><circle cx="900" cy="1194" r="12" fill="#b5b8b3" opacity=".35"/><circle cx="935" cy="1240" r="16" fill="#a3aba8" opacity=".25"/><path d="M${waxing?850:982} 1150 A66 66 0 0 ${waxing?1:0} ${waxing?850:982} 1282 A${Math.max(1,darkW)} 66 0 0 ${waxing?0:1} ${waxing?850:982} 1150" fill="#081d2c" opacity=".96"/>`;
 const dateLabel=new Date(`${p.day}T12:00:00Z`);
 const dateText=Number.isNaN(dateLabel.getTime())?p.day:new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(dateLabel).toUpperCase();
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
 <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#03182b" stop-opacity=".18"/><stop offset=".65" stop-color="#01243a" stop-opacity=".40"/><stop offset="1" stop-color="#00344b" stop-opacity=".75"/></linearGradient><linearGradient id="bankShade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#03253c" stop-opacity=".03"/><stop offset=".42" stop-color="#031b30" stop-opacity=".30"/><stop offset=".75" stop-color="#031a2c" stop-opacity=".87"/><stop offset="1" stop-color="#031827" stop-opacity=".96"/></linearGradient></defs>
 ${rr(0,0,W,H,'#087a9b',0)}${image(photo,0,0,1080,1600)}${rr(0,0,W,H,'url(#shade)',0)}
 ${t(38,79,'MARINE WEATHER',65,white,950)}${t(36,199,'JAMAICA',133,yellow,950)}
 ${t(42,247,'FISHING  •  BOATING  •  EXPLORING',25,white,850)}
 ${rr(34,272,646,94,'#03233e',15)}${t(54,323,dateText,43,white,900)}${t(55,350,'FORECAST WINDOW  07:00–17:00  JAMAICA TIME',18,'#d9f5ff',800)}
 ${panel(28,390,1024,301)}${t(48,434,'OVERALL MARINE CONDITIONS',34,white,950)}
 ${rr(48,455,355,108,statusColor,16)}${icon('wave',67,481,57,white)}${t(149,519,statusWord,54,white,950)}${t(151,547,`COMFORT  ${val(d,'comfort')}`,23,white,850)}
 ${t(429,485,truncate(val(d,'condition'),40),25,white,750)}${t(429,521,'KINGSTON  ·  MAIDEN CAY',20,'#a5ecff',850)}
 ${line(48,581,976)}${info(52,630,'wind','WIND / GUSTS',val(d,'wind'),`Gusts ${val(d,'gust')}`)}
 ${info(269,630,'wave','SEAS',val(d,'seas'))}${info(479,630,'tide','WAVE PERIOD',val(d,'period'))}
 ${info(710,630,'rain','RAIN',val(d,'rain'))}${info(873,630,'sun','UV INDEX',val(d,'uv'))}
 ${bank(28,1,'pelagic')}${bank(546,2,'reef')}
 ${panel(28,1141,482,203)}${top(30,1143,478,'TIDES  ·  KINGSTON')}
 ${icon('tide',49,1210,49,'#5ee0ff')}${t(121,1220,'HIGH',20,'#bcefff',850)}${t(121,1253,truncate(high,21),26,white,850)}
 ${icon('tide',49,1271,49,'#5ee0ff')}${t(121,1280,'LOW',20,'#bcefff',850)}${t(121,1314,truncate(low,21),26,white,850)}
 ${panel(526,1141,526,203)}${top(528,1143,522,'SUN & MOON')}
 ${icon('sun',547,1204,44,yellow)}${t(604,1215,'SUNRISE',18,'#c1efff',800)}${t(604,1248,val(d,'sunrise'),26,white,850)}
 ${icon('sun',547,1271,44,'#ffab41')}${t(604,1282,'SUNSET',18,'#c1efff',800)}${t(604,1315,val(d,'sunset'),26,white,850)}
 ${moonArt}${t(839,1312,truncate(moon,16).toUpperCase(),18,white,850)}${t(839,1333,`ILLUMINATION  ${illum}`,16,yellow,800)}
 ${panel(28,1361,1024,209)}${top(30,1363,1020,'OTHER CONDITIONS')}
 ${rr(40,1420,713,132,'#f1faff',15)}
 ${icon('current',56,1450,40,'#0877b1')}${t(105,1454,'SURFACE CURRENT',16,'#075a8b',850)}${t(105,1491,truncate(`${val(d,'current')} ${val(d,'currentDir','')}`,18),24,'#052c4d',850)}
 ${icon('thermo',304,1450,40,'#0877b1')}${t(352,1454,'SEA TEMPERATURE',16,'#075a8b',850)}${t(352,1491,val(d,'sst'),24,'#052c4d',850)}
 ${icon('compass',548,1450,40,'#0877b1')}${t(596,1454,'SWELL',16,'#075a8b',850)}${t(596,1491,truncate(val(d,'swell'),10),24,'#052c4d',850)}
 ${icon('warn',772,1446,51,yellow)}${t(840,1460,'SAFETY FIRST',27,cyan,950)}
 ${t(840,1491,'Check official marine',17,white,700)}${t(840,1515,'warnings before departure.',17,white,700)}${t(840,1539,'Not for navigation.',17,white,750)}
 ${p.preview?`${t(50,360,'DESIGN PREVIEW • NOT LIVE',18,'#ffdc4c',850)}`:''}
 </svg>`;
}
// Condition-specific Jamaican sea imagery is bundled locally; no network request is needed.
globalThis.__marineConditionPhotos={};
for(const condition of ['good','fair','poor']){
 try {
  const jpg=await readFile(resolve(`instagram/background-${condition}.jpg`));
  globalThis.__marineConditionPhotos[condition]=`data:image/jpeg;base64,${jpg.toString('base64')}`;
 }catch{console.warn(`Condition background unavailable: ${condition}; using fallback`);}
}
// Locally bundled illustrative marine imagery extracted from the approved visual reference.
globalThis.__marineArt={};
for(const name of ['pelagic','reef','kingston','moon']){
 try { const jpg=await readFile(resolve(`instagram/art/${name}.jpg`));globalThis.__marineArt[name]=`data:image/jpeg;base64,${jpg.toString('base64')}`; }
 catch { console.warn(`Optional illustration missing: ${name}`); }
}
// Local coastal photograph is embedded in the SVG; no network request or browser is needed.
try { const jpg=await readFile(resolve('instagram/sunset-background.jpg'));globalThis.__marineHeaderPhoto=`data:image/jpeg;base64,${jpg.toString('base64')}`; }catch{console.warn('Header photo unavailable; using ocean gradient');}
await mkdir(out,{recursive:true});
if(process.argv.includes('--preview')){
 const mock={day:'PREVIEW · NOT LIVE',preview:true,poster:{status:'GREEN',condition:'Calm to moderate',comfort:'2 / 5',wind:'12–16 kt',gust:'20 kt',seas:'1.0–1.5 m',rain:'20%',bank1:'Mackerel (Bowditch)',bank1status:'GREEN',bank1detail:'Moderate chop · ESE swell',bank1rain:'Scattered showers',bank2:'California Bank',bank2status:'AMBER',bank2detail:'Moderate seas · ESE swell',bank2rain:'Isolated showers',highTides:'06:12 · 18:41',lowTides:'12:28',moonPhase:'Waning Crescent',moonIllum:'21%',current:'0.6 kt',currentDir:'NE',sst:'28.1°C',uv:'8'}};
 await writeFile(resolve(out,'DESIGN-PREVIEW-ILLUSTRATIVE.png'),await sharp(Buffer.from(makeSvg(mock))).png().toBuffer());
 console.log('Wrote illustrative preview; no live weather values used');process.exit(0);
}

let last;
for(let attempt=1;attempt<=3;attempt++){
 try{
  const payload=await getForecast();const png=await sharp(Buffer.from(makeSvg(payload))).png({compressionLevel:8}).toBuffer();
  if(png.length<20000)throw Error('Rendered PNG unexpectedly small');
  await writeFile(resolve(out,`marine-weather-jamaica-${payload.day}.png`),png);
  await writeFile(resolve(out,'today.png'),png);
  console.log(`SUCCESS: ${payload.day}, ${png.length} bytes, Sharp 1080x1600, verified cached forecast`);process.exit(0);
 }catch(e){last=e;console.error(`Attempt ${attempt}/3: ${e.message}`);if(attempt<3)await new Promise(r=>setTimeout(r,2500));}
}
console.error('Forecast graphic not regenerated; existing PNG preserved.',last?.message);process.exit(1);
