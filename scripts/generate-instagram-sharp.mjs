import sharp from 'sharp';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

// Direct SVG → Sharp renderer. Uses the SAME verified spreadsheet-backed instagramData payload.
const endpoint=process.env.INSTAGRAM_DATA_URL || 'https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const out=resolve(process.env.OUTPUT_DIR||'instagram/generated');
const selectedDay=process.argv.includes('--day')?process.argv[process.argv.indexOf('--day')+1]:'tomorrow';
if(!['today','tomorrow'].includes(selectedDay))throw Error('Use --day today or --day tomorrow');
const dayOffset=selectedDay==='tomorrow'?1:0;
const jamaicaDay=(offset=0)=>{const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
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
// Compatibility adapter: supports the published GS Instagram payload and modest
// schema evolution without relaxing stale-data or authoritative-score safeguards.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const first=(o,keys)=>keys.map(k=>o?.[k]).find(v=>v!==null&&v!==undefined&&String(v).trim()!=='');
const normalizedDay=(v)=>{
  if(typeof v!=='string')return null;
  const match=v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match?match[0]:null;
};
const normalizedStatus=(v)=>{
  const s=String(v??'').trim().toUpperCase();
  return ({GREEN:'GREEN',GOOD:'GREEN',YELLOW:'AMBER',AMBER:'AMBER',ORANGE:'AMBER',FAIR:'AMBER',RED:'RED',CAUTION:'RED'})[s]||null;
};
const numeric=(v)=>Number.isFinite(Number.parseFloat(String(v??'')))&& !/^(?:—|-|unavailable|n\/a)$/i.test(String(v??'').trim());
function validateForecast(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Forecast payload is not an object');
  const data=raw.data&&typeof raw.data==='object'&&!Array.isArray(raw.data)&&!raw.poster?raw.data:raw;
  if(data.ok===false||data.success===false)throw Error('Forecast service reports an unsuccessful result');
  // Explicitly stale or delayed responses are never published.
  if(data.stale===true||data.isStale===true||/^(delayed|stale|expired)$/i.test(String(first(data,['freshness','dataFreshness'])??'')))
    throw Error('Cached forecast is marked delayed; existing PNG preserved');
  const expected=jamaicaDay(dayOffset);
  const day=normalizedDay(first(data,['day','forecastDay','forecastDate','date']));
  if(!day||day!==expected)throw Error(`Forecast date mismatch: received ${day||'unknown'}, expected ${expected}`);
  const poster=data.poster||data.instagram||data.fields;
  if(!poster||typeof poster!=='object'||Array.isArray(poster))throw Error('Forecast response has no poster fields');
  const d={...poster};
  // Accept common spelling changes while keeping GS-computed status authoritative.
  const aliases={status:['status','conditionColor','colour','color'],comfort:['comfort','comfortScore'],
    wind:['wind','avgWind'],gust:['gust','gusts','peakGust'],seas:['seas','waves','avgSeas'],
    period:['period','chop','wavePeriod'],rain:['rain','rainfall'],uv:['uv','uvIndex'],
    bank1status:['bank1status','bank1Status'],bank2status:['bank2status','bank2Status'],
    bank1:['bank1','bank1Name'],bank2:['bank2','bank2Name']};
  for(const [key,keys] of Object.entries(aliases))if(!valid(d[key]))d[key]=first(d,keys);
  for(const key of ['status','bank1status','bank2status']){
    const status=normalizedStatus(d[key]);
    if(!status)throw Error(`Missing authoritative ${key}; refresh the GS score snapshots first`);
    d[key]=status;
  }
  if(!numeric(d.comfort))throw Error('Missing authoritative comfort score; refresh the GS score snapshots first');
  for(const key of ['wind','gust','seas','period'])if(!numeric(d[key]))throw Error(`Required marine metric unavailable: ${key}`);
  // These are display-only and may be absent in older/newer GS deployments.
  for(const key of ['uv','rain','current','currentDir','sst','swell','highTides','lowTides','moonPhase','moonIllum','sunrise','sunset','moonrise','moonset','peakWind','peakWave'])
    if(!valid(d[key]))d[key]='—';
  d.bank1=d.bank1||'MACKEREL (BOWDITCH)';d.bank2=d.bank2||'CALIFORNIA BANK';
  // The authoritative Apps Script supplies destination-specific screened windows.
  // Never invent departure/return times when its hourly screening finds none.
  if(!Array.isArray(d.travelWindows) || d.travelWindows.length!==3)
    throw Error('Departure and return windows missing from forecast payload');
  for(const w of d.travelWindows){
    if(!w || !valid(w.destination) || !valid(w.departure) || !valid(w.return))
      throw Error('Incomplete departure/return window; existing PNG preserved');
  }
  d.freshness='Current';
  // Missing optional fields do not invalidate a real forecast. Required scores,
  // dates and sea-state values above are checked independently.
  const missing=Array.isArray(data.missing)?data.missing:[];
  if(missing.length)console.warn('FORECAST DIAGNOSTICS:',missing.map(x=>String(x).slice(0,130)).slice(0,15).join(' | '));
  // Require GS authoritative snapshot and hourly-cache readiness for every site.
  if(data.ready!==true)throw Error('Forecast service not ready: '+(missing.length?missing.join(' | '):'verification incomplete'));
  return {...data,day,poster:d};
}
async function getForecast(){
  // Match the callback naming convention of the proven browser-based Instagram Studio.
  const cb=`mwInstagramCallback_${Date.now()}_1`;
  const url=new URL(endpoint);url.searchParams.set('action','instagramData');url.searchParams.set('day',selectedDay);url.searchParams.set('callback',cb);
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
function makeSvg(p){
 const d={...p.poster};
 // GS is authoritative for solar times; no client-side fallback.
 const W=1080,H=1560;
 const navy='#03263e',deep='#041c30',cyan='#25c8f1',yellow='#ffdf28',white='#fff';
 const [statusColor,,statusWord]=theme(val(d,'status','AMBER'));
 const overall=String(val(d,'status','AMBER')).toUpperCase();
 const backgroundKey=overall==='GREEN'?'good':overall==='RED'?'poor':'fair';
 const photo=globalThis.__marineConditionPhotos?.[backgroundKey];
 if(!photo)throw Error(`Required condition background unavailable: ${backgroundKey}`);
 const t=(x,y,value,size=24,color=white,weight=700,extra='')=>label(x,y,value,size,color,weight,extra);
 const rr=(x,y,w,h,c,r=18,extra='')=>rect(x,y,w,h,c,r,extra);
 const image=(src,x,y,w,h,opacity=1)=>src?`<image href="${src}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>`:'';
 const icon=(name,x,y,size=42,color=cyan)=>{
  const paths={wind:'M3 8h15a4 4 0 0 0-4-4 M2 13h20a3 3 0 1 1-3 3 M4 18h10a3 3 0 1 1-3 3',wave:'M2 15c4-7 8-7 12 0s8 7 12 0 M2 22c4-7 8-7 12 0s8 7 12 0',rain:'M7 17a6 6 0 0 1 1-12 8 8 0 0 1 15 4 5 5 0 0 1-1 10H7 M9 23l-2 5 M17 23l-2 5 M25 23l-2 5',sun:'M16 4v5 M16 23v5 M4 16h5 M23 16h5 M7.5 7.5l3.5 3.5 M21 21l3.5 3.5 M24.5 7.5L21 11 M11 21l-3.5 3.5 M16 11a5 5 0 1 0 0 10 5 5 0 0 0 0-10',tide:'M2 12q7-8 14 0t14 0 M2 21q7-8 14 0t14 0',current:'M6 16h20 M19 9l7 7-7 7 M16 3a13 13 0 1 0 0 26',thermo:'M12 5a4 4 0 0 1 8 0v15a7 7 0 1 1-8 0z M16 10v15',compass:'M16 2l5 13-5 15-5-15z',warn:'M16 3L2 29h28z M16 12v8 M16 25v1',target:'M16 2v6 M16 24v6 M2 16h6 M24 16h6 M16 9a7 7 0 1 0 0 14 7 7 0 0 0 0-14'};
  return `<g transform="translate(${x} ${y}) scale(${size/32})" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]||paths.wave}"/></g>`;
 };
 const panel=(x,y,w,h)=>rr(x,y,w,h,'#042a43',18,'fill-opacity="0.82" stroke="#b6f5ff" stroke-width="2"');
 const top=(x,y,w,title)=>`${rr(x,y,w,48,'#04243c',13)}${t(x+18,y+33,title,24,white,900)}`;
 const line=(x,y,w)=>`<path d="M${x} ${y}h${w}" stroke="#4db8d1" stroke-width="2"/>`;
 const info=(x,y,ic,title,value,sub='',w=160)=>`${icon(ic,x,y-35,39)}${t(x+48,y-15,title,17,'#bdefff',800)}${t(x+48,y+17,truncate(value,18),25,white,850)}${sub?t(x+48,y+41,truncate(sub,22),16,'#ccecf6',600):''}`;
 const bank=(x,n,focus)=>{
  const [c,,word]=theme(val(d,`bank${n}status`,'AMBER'));
  const name=truncate(val(d,`bank${n}`,'FISHING BANK'),28).toUpperCase();
  const picture=globalThis.__marineArt?.[focus]||'';
  const detail=val(d,`bank${n}detail`);
  const rain=val(d,`bank${n}rain`);
  const comfort=val(d,`bank${n}comfort`,'');
  return `${panel(x,710,506,413)}${image(picture,x+3,763,500,355)}
   <rect x="${x+3}" y="762" width="500" height="356" fill="url(#bankShade)"/>
   ${top(x+3,713,500,name)}
   ${rr(x+331,774,156,52,c,13)}${t(x+409,806,word,27,white,900,'text-anchor="middle"')}${comfort?t(x+409,822,`COMFORT ${comfort}`,13,white,750,'text-anchor="middle"'):''}
   ${icon('target',x+22,873,36,white)}${t(x+71,888,focus==='pelagic'?'PELAGIC FOCUS':'BOTTOM / REEF FOCUS',19,'#d8f7ff',850)}
   ${t(x+71,914,focus==='pelagic'?'Tuna · Wahoo · Dolphin':'Snapper · Grouper · Reef fish',18,white,650)}
   ${icon('wave',x+22,930,36,'#a7efff')}${t(x+71,949,'CONDITIONS',18,'#b6ecff',850)}
   ${t(x+71,975,truncate(detail,32),19,white,650)}
   ${icon('rain',x+22,988,36,'#56d7ff')}${t(x+71,1006,'RAIN / OUTLOOK',18,'#b6ecff',850)}
   ${t(x+71,1032,truncate(rain,32),19,white,650)}`;
 };
 const high=val(d,'highTides'),low=val(d,'lowTides');
 const tideEntries=(raw)=>valid(raw)?String(raw).split(/\s*[·;,|]\s*/).map(x=>x.trim()).filter(Boolean).slice(0,2):[];
 const highEntries=tideEntries(high),lowEntries=tideEntries(low);
 const tideLine=(entries,x,y)=>entries.length?entries.map((entry,i)=>t(x,y+i*26,truncate(entry,20),22,white,850)).join(''):t(x,y,'Not available',19,'#b7d2de',650);
 const moonrise=val(d,'moonrise',val(d,'moonRise',''));
 const moonset=val(d,'moonset',val(d,'moonSet',''));
 const moon=val(d,'moonPhase'),illum=val(d,'moonIllum');
 const moonPhase=moon.toLowerCase();
 // Accurate phase geometry: illuminated fraction controls the terminator ellipse.
 // Waning phases are lit on the left; waxing phases are lit on the right.
 const fractionRaw=parseFloat(illum);
 const fraction=Number.isFinite(fractionRaw)?Math.max(0,Math.min(1,fractionRaw/100)):(moonPhase.includes('full')?1:moonPhase.includes('new')?0:0.5);
 const waxing=moonPhase.includes('waxing')||moonPhase.includes('first');
 const r=66,cx=916,cy=1216;
 const halfWidth=Math.abs(2*fraction-1)*r;
 // Start with dark disc. Paint the illuminated half, then add or subtract
 // the elliptical terminator. All shapes stay inside the circular silhouette.
 const litSide=waxing?'right':'left';
 const halfPath=litSide==='right'
   ?`M${cx} ${cy-r} A${r} ${r} 0 0 1 ${cx} ${cy+r} Z`
   :`M${cx} ${cy-r} A${r} ${r} 0 0 0 ${cx} ${cy+r} Z`;
 const ellipseFill=fraction>=0.5?'#e4e5d5':'#081d2c';
 const moonArt=`<defs><clipPath id="moon-disc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><clipPath id="moon-left"><rect x="${cx-r}" y="${cy-r}" width="${r}" height="${2*r}"/></clipPath><clipPath id="moon-right"><rect x="${cx}" y="${cy-r}" width="${r}" height="${2*r}"/></clipPath></defs>`+
   `<g clip-path="url(#moon-disc)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#081d2c"/>`+
   `<path d="${halfPath}" fill="#e4e5d5"/>`+
   `<g clip-path="url(#moon-${fraction>=0.5?(waxing?'left':'right'):(waxing?'right':'left')})"><ellipse cx="${cx}" cy="${cy}" rx="${halfWidth}" ry="${r}" fill="${ellipseFill}"/></g>`+
   `</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#dce6e7" stroke-width="1" opacity=".35"/>`;
 const travel=Array.isArray(d.travelWindows)?d.travelWindows:[];
 const travelRows=travel.slice(0,3).map((w,i)=>{
   const y=1427+i*38;
   const names=['MAIDEN CAY','MACKEREL BANK','CALIFORNIA BANK'];
   const dep=valid(w?.departure)?w.departure:'Not available';
   const ret=valid(w?.return)?w.return:'Not available';
   const peak=(numeric(w?.maxGustKn)&&valid(w?.maxGustTime))
     ?`${Number(w.maxGustKn).toFixed(1)} kt (${w.maxGustTime})`:'Not available';
   return `${t(50,y,names[i],17,white,850)}${t(314,y,truncate(dep,19),17,'#c5efff',800)}${t(554,y,truncate(ret,19),17,'#c5efff',800)}${t(800,y,truncate(peak,24),17,white,800)}`;
 }).join('');
 const dateLabel=new Date(`${p.day}T12:00:00Z`);
 const dateText=Number.isNaN(dateLabel.getTime())?p.day:new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(dateLabel).toUpperCase();
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
 <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#03182b" stop-opacity=".18"/><stop offset=".65" stop-color="#01243a" stop-opacity=".40"/><stop offset="1" stop-color="#00344b" stop-opacity=".75"/></linearGradient><linearGradient id="bankShade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#03253c" stop-opacity=".03"/><stop offset=".42" stop-color="#031b30" stop-opacity=".30"/><stop offset=".75" stop-color="#031a2c" stop-opacity=".87"/><stop offset="1" stop-color="#031827" stop-opacity=".96"/></linearGradient></defs>
 ${rr(0,0,W,H,'#087a9b',0)}${image(photo,0,0,1080,H)}${rr(0,0,W,H,'url(#shade)',0)}
 ${rr(28,18,1024,81,'#03233e',15)}${t(52,63,dateText,35,white,900)}${t(52,88,'07:00–17:00 JAMAICA TIME  ·  KINGSTON / MAIDEN CAY',17,'#ccefff',750)}${t(923,62,val(d,'freshness','N/A').toUpperCase(),17,'#b8ffda',850)}
 <g transform="translate(0,-276)">${panel(28,390,1024,301)}${t(48,434,'OVERALL MARINE CONDITIONS',34,white,950)}
 ${rr(48,455,355,108,statusColor,16)}${icon('wave',67,481,57,white)}${t(149,519,statusWord,54,white,950)}${t(151,547,`COMFORT  ${val(d,'comfort')}`,23,white,850)}
 ${t(429,485,truncate(val(d,'condition'),40),25,white,750)}${t(429,521,'KINGSTON  ·  MAIDEN CAY',20,'#a5ecff',850)}
 ${line(48,581,976)}${info(52,630,'wind','WIND / GUSTS',val(d,'wind'),`Gusts ${val(d,'gust')}`)}
 ${info(269,630,'wave','SEAS',val(d,'seas'))}${info(479,630,'tide','WAVE PERIOD',val(d,'period'))}
 ${info(710,630,'rain','RAIN',val(d,'rain'))}${info(873,630,'sun','UV INDEX',val(d,'uv'))}
 ${bank(28,1,'pelagic')}${bank(546,2,'reef')}
 ${panel(28,1141,482,255)}${top(30,1143,478,'TIDES  ·  KINGSTON')}
 ${icon('tide',49,1210,49,'#5ee0ff')}${t(121,1214,'HIGH',20,'#bcefff',850)}${tideLine(highEntries,121,1241)}
 ${icon('tide',49,1312,49,'#5ee0ff')}${t(121,1312,'LOW',20,'#bcefff',850)}${tideLine(lowEntries,121,1339)}
 ${panel(526,1141,526,255)}${top(528,1143,522,'SUN & MOON')}
 ${icon('sun',547,1204,44,yellow)}${t(604,1215,'SUNRISE',18,'#c1efff',800)}${t(604,1248,val(d,'sunrise'),26,white,850)}
 ${icon('sun',547,1271,44,'#ffab41')}${t(604,1282,'SUNSET',18,'#c1efff',800)}${t(604,1315,val(d,'sunset'),26,white,850)}
 ${moonArt}${t(835,1307,truncate(moon,16).toUpperCase(),17,white,850)}${t(835,1330,`ILLUMINATION  ${illum}`,15,yellow,800)}${t(550,1364,`MOONRISE  ${moonrise||'—'}`,16,'#c1efff',800)}${t(793,1364,`MOONSET  ${moonset||'—'}`,16,'#c1efff',800)}
 ${panel(28,1413,1024,209)}${top(30,1415,1020,'OTHER CONDITIONS')}
 ${rr(40,1472,713,132,'#f1faff',15)}
 ${icon('current',56,1502,40,'#0877b1')}${t(105,1506,'SURFACE CURRENT',16,'#075a8b',850)}${t(105,1543,truncate(`${val(d,'current')} ${val(d,'currentDir','')}`,18),24,'#052c4d',850)}
 ${icon('thermo',304,1502,40,'#0877b1')}${t(352,1506,'SEA TEMPERATURE',16,'#075a8b',850)}${t(352,1543,val(d,'sst'),24,'#052c4d',850)}
 ${icon('compass',548,1502,40,'#0877b1')}${t(596,1506,'SWELL',16,'#075a8b',850)}${t(596,1543,truncate(val(d,'swell'),10),24,'#052c4d',850)}
 ${icon('warn',772,1498,51,yellow)}${t(840,1512,'SAFETY FIRST',27,cyan,950)}
 ${t(840,1543,'Check official marine',17,white,700)}${t(840,1567,'warnings before departure.',17,white,700)}${t(840,1591,'Not for navigation.',17,white,750)}
 </g>
 ${panel(28,1343,1024,206)}${top(30,1345,1020,'SUGGESTED DEPARTURE & RETURN · JAMAICA TIME')}
 ${t(50,1392,'LOCATION',15,cyan,850)}${t(314,1392,'DEPART (OUT)',15,cyan,850)}${t(554,1392,'RETURN (BACK)',15,cyan,850)}${t(800,1392,'MAX GUST (TIME)',15,cyan,850)}
 ${line(48,1403,978)}${travelRows}
 ${t(49,1534,'Forecast guidance only · Route, vessel and transit time not assessed · Not for navigation',15,'#c7e9f4',650)}
 ${p.preview?`${t(50,360,'DESIGN PREVIEW • NOT LIVE',18,'#ffdc4c',850)}`:''}
 </svg>`;
}
// Condition-specific Jamaican sea imagery is bundled locally; no network request is needed.
globalThis.__marineConditionPhotos={};
for(const condition of ['good','fair','poor']){
 try {
  const jpg=await readFile(resolve(`instagram/background-${condition}.jpg`));
  globalThis.__marineConditionPhotos[condition]=`data:image/jpeg;base64,${jpg.toString('base64')}`;
 }catch(e){throw Error(`Required condition background missing: ${condition}: ${e.message}`);}
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
  const dated=resolve(out,`marine-weather-jamaica-${payload.day}.png`);
  const alias=resolve(out,`${selectedDay}.png`);
  const metadata=resolve(out,`${selectedDay}-freshness.json`);
  const sha256=createHash('sha256').update(png).digest('hex');
  const record={forecastDay:payload.day,selection:selectedDay,generatedAt:new Date().toISOString(),sha256,bytes:png.length};
  // Render and verify completely before replacing any existing public image.
  const temp=resolve(out,`.${selectedDay}-${process.pid}.png.tmp`);
  await writeFile(temp,png);
  const inspected=await sharp(temp).metadata();
  if(inspected.format!=='png'||inspected.width!==1080||inspected.height!==1560)throw Error('Rendered PNG dimensions/format invalid');
  await rename(temp,dated);
  await writeFile(alias,png);
  await writeFile(metadata,JSON.stringify(record,null,2)+'\n');
  console.log(`SUCCESS: ${selectedDay} ${payload.day}, ${png.length} bytes, verified cached forecast`);process.exit(0);
 }catch(e){last=e;console.error(`Attempt ${attempt}/3: ${e.message}`);if(attempt<3)await new Promise(r=>setTimeout(r,2500));}
}
console.error('Forecast graphic not regenerated; existing PNG preserved.',last?.message);process.exit(1);
