import sharp from 'sharp';
import {mkdir,writeFile,rename,rm,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const endpoint=process.env.SEVEN_DAY_DATA_URL;
if(!endpoint)throw Error('Missing SEVEN_DAY_DATA_URL secret');
const test=process.env.MARINE7_TEST==='1';
const root=resolve(test?'instagram/seven-day-test':'instagram/generated');
const zone='America/Jamaica';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plus=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fmt=(x,n=1)=>Number(x).toFixed(n);
const txt=(x,y,s,size=25,color='#fff',weight=600)=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(s)}</text>`;
const box=(x,y,w,h,color)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="15" fill="${color}"/>`;
const color=s=>({GREEN:'#16834b',YELLOW:'#bd8614',AMBER:'#bd8614',RED:'#b83b42'})[s];
// Accept strict JSON or one matching JSONP callback, without evaluating remote JavaScript.
export function parseMasterFeed(body, callback){
 const source=String(body).replace(/^\uFEFF/,'').trim();
 if(source.startsWith('{'))return JSON.parse(source);
 const match=source.match(/^(?:\/\*[\s\S]*?\*\/\s*)?([A-Za-z_$][\w$]*)\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/);
 if(!match)throw Error('Feed is neither a JSON object nor a single JSONP callback');
 if(match[1]!==callback)throw Error('JSONP callback mismatch');
 return JSON.parse(match[2]);
}
async function getFeed(){
 const cb='mwInstagramCallback_'+Date.now()+'_1',url=new URL(endpoint);
 url.searchParams.set('action','marine7master');url.searchParams.set('callback',cb);
 const response=await fetch(url,{signal:AbortSignal.timeout(65000),headers:{Accept:'*/*'}});
 const body=await response.text();
 const source=body.replace(/^\uFEFF/,'').trim();
 const format=source.startsWith('{')?'JSON':/^[A-Za-z_$][\w$]*\s*\(/.test(source)?'JSONP':/^<!doctype|^<html/i.test(source)?'HTML':'other';
 console.log('MASTER CACHE RESPONSE:',JSON.stringify({status:response.status,format,contentType:(response.headers.get('content-type')||'unknown').split(';')[0],bytes:Buffer.byteLength(body)}));
 if(!response.ok)throw Error('Master-cache feed request failed: HTTP '+response.status);
 try{return parseMasterFeed(body,cb);}catch(e){throw Error('Master-cache feed parse failed: '+e.message+' (format='+format+')');}
}

function validate(feed){
 if(!feed?.ok||feed.source!=='Marine7DayCache'||!['marine7-cache-only-v3','marine7-cache-only-v4'].includes(feed.schemaVersion)||!['v3','v4'].includes(feed.comfortScoreVersion)||feed.timezone!==zone||feed.days?.length!==7)throw Error('Unexpected master-cache schema');
 const all=new Set(),sites=new Set(),now=Date.now(),maxAge=24*3600*1000;
 feed.days.forEach((d,i)=>{
  if(d.date!==plus(today(),i)||d.dayOffset!==i||!d.ready||d.locations?.length!==14)throw Error('Missing/old forecast day '+i);
  d.locations.forEach(s=>{
   const id=d.date+'|'+s.id;if(all.has(id))throw Error('Duplicate '+id);all.add(id);sites.add(s.id);
   if(!s.ready||s.stale||s.scoreVersion!==feed.comfortScoreVersion||!['GREEN','YELLOW','AMBER','RED'].includes(s.status)||!s.conditionLabel?.trim()||!Number.isFinite(s.score))throw Error('Missing cached v3 status '+id);
   for(const k of ['windKn','gustKn','waveM','peakWaveM','wavePeriodS','rainMm','rainProbabilityPct'])if(!Number.isFinite(s[k]))throw Error('Missing '+k+' '+id);
   if(s.rainProbabilityPct<0||s.rainProbabilityPct>100)throw Error('Invalid rainfall probability '+id);
   for(const k of ['updatedAt','cacheBuiltAt']){const t=Date.parse(s[k]);if(!Number.isFinite(t)||t>now+300000||now-t>maxAge)throw Error('Stale '+k+' '+id);}
  });
 });
 if(all.size!==98||sites.size!==14)throw Error('Master cache must contain 98 unique location-day records');
 for(const id of ['maiden','bowditch','california'])if(!sites.has(id))throw Error('Missing poster location '+id);
}

const valid=v=>v!==null&&v!==undefined&&String(v).trim()&&!/^(unavailable|n\/a|undefined|null|—|-)$/i.test(String(v).trim());
const val=(d,k,f='—')=>valid(d[k])?String(d[k]):f;
const truncate=(v,n=28)=>String(v).length>n?String(v).slice(0,n-1)+'…':String(v);
const label=(x,y,t,size=22,color='#102c49',weight=700,extra='')=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="Arial, DejaVu Sans, sans-serif" ${extra}>${esc(t)}</text>`;
const rect=(x,y,w,h,fill,r=14,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const theme=s=>s==='GREEN'?['#0c984b','#e5f7e8','GOOD']:s==='RED'?['#bf3434','#fff0ef','CAUTION']:(s==='YELLOW'||s==='AMBER')?['#c68a08','#fff6d6','FAIR']:['#456b83','#e9f0f5','UNRATED'];

function makeSvg(p){
 const d={...p.poster};
 // GS is authoritative for solar times; no client-side fallback.
 const W=1080,H=1560;
 const navy='#03263e',deep='#041c30',cyan='#25c8f1',yellow='#ffdf28',white='#fff';
 const [statusColor,,statusWord]=theme(val(d,'status','UNRATED'));
 const overall=String(val(d,'status','UNRATED')).toUpperCase();
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
  const [c,,word]=theme(val(d,`bank${n}status`,'UNRATED'));
  const name=truncate(val(d,`bank${n}`,'FISHING BANK'),28).toUpperCase();
  const picture=globalThis.__marineArt?.[focus]||'';
  const mixedPicture=focus==='mixed';
  const hasDeparture=Array.isArray(d.travelWindows) && valid(d.travelWindows[n]?.departure) && d.travelWindows[n].departure!=='None identified';
  // Per-bank visual treatment: no usable departure window => fade the photo, keep text readable.
  const photoOpacity=hasDeparture?1:0.12;
  const bankPicture=mixedPicture ? `${image(globalThis.__marineArt?.pelagic,x+3,763,500,178,photoOpacity)}${image(globalThis.__marineArt?.reef,x+3,941,500,177,photoOpacity)}` : image(picture,x+3,763,500,355,photoOpacity);
  const detail=val(d,`bank${n}detail`);
  const rain=val(d,`bank${n}rain`);
  const comfort=val(d,`bank${n}comfort`,'');
  return `${panel(x,710,506,413)}${bankPicture}
   <rect x="${x+3}" y="762" width="500" height="356" fill="${hasDeparture?'url(#bankShade)':'#052d43'}" fill-opacity="${hasDeparture?1:0.78}"/>
   ${top(x+3,713,500,name)}
   ${rr(x+331,774,156,52,c,13)}${t(x+409,806,word,27,white,900,'text-anchor="middle"')}${comfort?t(x+409,822,`COMFORT ${comfort}`,13,white,750,'text-anchor="middle"'):''}
   ${icon('target',x+22,873,36,white)}${t(x+71,888,focus==='pelagic'?'PELAGIC FOCUS':focus==='reef'?'BOTTOM / REEF FOCUS':'MIXED FISHING',19,'#d8f7ff',850)}
   ${t(x+71,914,focus==='pelagic'?'Tuna · Wahoo · Dolphin':focus==='reef'?'Snapper · Grouper · Reef fish':'Pelagic · Bottom / Reef',18,white,650)}
   ${icon('wave',x+22,930,36,'#a7efff')}${t(x+71,949,'CONDITIONS',18,'#b6ecff',850)}
   ${t(x+71,975,truncate(detail,32),19,white,650)}
   ${icon('rain',x+22,988,36,'#56d7ff')}${t(x+71,1006,'RAIN / OUTLOOK',18,'#b6ecff',850)}
   ${t(x+71,1032,truncate(rain,32),19,white,650)}`;
 };
 const high=val(d,'highTides'),low=val(d,'lowTides');
 const tideEntries=(raw)=>valid(raw)&&raw!=='Not available'?String(raw).split(/\s*[·;,|]\s*/).map(x=>x.trim()).filter(Boolean).slice(0,2):[];
 const highEntries=tideEntries(high),lowEntries=tideEntries(low);
 const tideLine=(entries,x,y)=>entries.length?entries.map((entry,i)=>t(x,y+i*26,truncate(entry,25),22,white,850)).join(''):t(x,y,'Not available',19,'#b7d2de',650);
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
 const travel=Array.isArray(d.travelWindows)?d.travelWindows:Array.isArray(maiden.travelWindows)?maiden.travelWindows:[];
 const travelRows=travel.slice(0,3).map((w,i)=>{
   const y=1427+i*38;
   const names=['MAIDEN CAY','MACKEREL BANK','CALIFORNIA BANK'];
   const dep=valid(w?.departure)?w.departure:'Not available';
   const ret=valid(w?.return)?w.return:'Not available';
   const peak=(Number.isFinite(w?.maxGustKn)&&valid(w?.maxGustTime))
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
 ${rr(48,455,355,108,statusColor,16)}${icon('wave',67,481,57,white)}${d.rainIndicator?icon('rain',354,484,38,white):''}${t(149,519,statusWord,54,white,950)}${t(151,547,`COMFORT ${val(d,'comfort','NOT SCORED')} · V3`,19,white,850)}
 ${t(429,485,'Forecast guidance · v3 comfort assessment',22,white,750)}${t(429,521,'KINGSTON  ·  MAIDEN CAY',20,'#a5ecff',850)}
 ${line(48,581,976)}${info(52,630,'wind','WIND / GUSTS',val(d,'wind'),`Gusts ${val(d,'gust')}`)}
 ${info(269,630,'wave','SEAS',val(d,'seas'))}${info(479,630,'tide','WAVE PERIOD',val(d,'period'))}
 ${info(710,630,'rain','RAIN',val(d,'rain'))}${info(873,630,'sun','UV INDEX',val(d,'uv'))}
 ${bank(28,1,'mixed')}${bank(546,2,'mixed')}
 ${panel(28,1141,482,255)}${top(30,1143,478,'TIDES  ·  KINGSTON (MODEL)')}
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
 ${line(48,1403,978)}${travelRows || t(50,1450,'NOT ASSESSED · No verified departure or return windows',21,white,800)}
 ${t(49,1534,'Weather guidance only · Not a vessel or route clearance',15,'#c7e9f4',650)}
 ${t(746,87,'7-DAY OUTLOOK',15,'#ffdc4c',850)}
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


const present=(v)=>v!==null&&v!==undefined&&String(v).trim()!=='';
const numberText=(v,unit='',dec=1)=>Number.isFinite(v)?`${v.toFixed(dec)}${unit?' '+unit:''}`:'Not available';
const compass=(deg)=>Number.isFinite(deg)?['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round((((deg%360)+360)%360)/22.5)%16]:'';
const field=(site,...keys)=>keys.map(k=>site?.[k]).find(present);
const timeValue=(v)=>present(v)?String(v):'Not available';
function windowFromEvidence(site){
 const samples=site.hourlyEvidence;
 if(!Array.isArray(samples)||samples.length!==10||samples.some((h,i)=>h.hour!==i+7||!h.complete))return {departure:'Not assessed',return:'Not assessed',maxGustKn:null,maxGustTime:null};
 const safe=h=>['windKn','gustKn','waveM','wavePeriodS','rainMm','rainProbabilityPct'].every(k=>Number.isFinite(h[k]))&&h.windKn<=12&&h.gustKn<=15&&h.waveM<=1&&h.wavePeriodS>=4&&h.rainMm<2&&h.rainProbabilityPct<70;
 const runs=[];let run=[];for(let hour=7;hour<17;hour++){const h=samples.find(s=>s.hour===hour);if(h&&safe(h))run.push(hour);else if(run.length){runs.push(run);run=[];}}if(run.length)runs.push(run);
 const usable=runs.filter(r=>r.length>=2),fmtHour=h=>`${String(h).padStart(2,'0')}:00`;
 const peak=samples.reduce((best,h)=>!best||h.gustKn>best.gustKn?h:best,null);
 return {departure:usable.length?`${fmtHour(usable[0][0])}–${fmtHour(usable[0].at(-1)+1)}`:'None identified',return:usable.length?`${fmtHour(usable.at(-1)[0])}–${fmtHour(usable.at(-1).at(-1)+1)}`:'None identified',maxGustKn:peak?.gustKn??null,maxGustTime:peak?fmtHour(peak.hour):null};
}
function graphicalPoster(day){
 const by=id=>day.locations.find(s=>s.id===id);
 const maiden=by('maiden'),bow=by('bowditch'),cal=by('california');
 const fmtSite=s=>`${numberText(s.windKn,'kn')} wind · ${numberText(s.waveM,'m')} seas · ${numberText(s.wavePeriodS,'s')} period`;
 const rainSite=s=>`${numberText(s.rainMm,'mm')} · peak rain chance ${numberText(s.rainProbabilityPct,'%',0)}`;
 const sky=day.astronomy||{};
 const poster={
  status:maiden.status,comfort:`${Number(maiden.score).toFixed(1)}/5`,freshness:'CURRENT',
  wind:numberText(maiden.windKn,'kn'),gust:numberText(maiden.gustKn,'kn'),seas:numberText(maiden.waveM,'m'),period:numberText(maiden.wavePeriodS,'s'),rain:numberText(maiden.rainMm,'mm'),uv:numberText(field(maiden,'uvMax','uvIndex')),
  bank1:'Mackerel (Bowditch)',bank1status:bow.status,bank1comfort:`${Number(bow.score).toFixed(1)}/5`,bank1detail:fmtSite(bow),bank1rain:rainSite(bow),
  bank2:'California Bank',bank2status:cal.status,bank2comfort:`${Number(cal.score).toFixed(1)}/5`,bank2detail:fmtSite(cal),bank2rain:rainSite(cal),
  bank1focus:'mixed',bank2focus:'mixed',
  highTides:timeValue(field(maiden,'highTides')??field(day,'highTides')),lowTides:timeValue(field(maiden,'lowTides')??field(day,'lowTides')),
  sunrise:timeValue(sky.sunrise),sunset:timeValue(sky.sunset),moonrise:timeValue(sky.moonrise),moonset:timeValue(sky.moonset),moonPhase:timeValue(sky.moonPhase),moonIllum:Number.isFinite(Number(sky.moonIllum))&&present(sky.moonIllum)?`${Math.round(Number(sky.moonIllum))}%`:'Not available',
  current:maiden.currentUnitVerified===true?numberText(maiden.currentKn,'kn'):'Not available',currentDir:maiden.currentUnitVerified===true?compass(maiden.currentDirectionDeg):'',sst:numberText(maiden.sstC,'°C'),swell:`${numberText(maiden.swellM,'m')} ${compass(maiden.swellDirectionDeg)}`,
  travelWindows:[maiden,bow,cal].map(windowFromEvidence)
 };
 return makeSvg({day:day.date,poster,extended:day.dayOffset>=3});
}
// Stamp each freshly rendered PNG with a unique, standards-compliant PNG tEXt chunk.
// This changes the PNG bytes on every GitHub run even when the forecast picture is identical.
// Git otherwise cannot commit a "replacement" with identical content.
const renderId = [new Date().toISOString(), process.env.GITHUB_RUN_ID || 'local', process.env.GITHUB_RUN_ATTEMPT || '1'].join('|');
const pngCrcTable = Array.from({length:256},(_,n)=>{let c=n;for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0;});
function pngCrc32(data){let crc=0xffffffff;for(const b of data)crc=pngCrcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function stampPng(png,date){
 const signature=Buffer.from('89504e470d0a1a0a','hex');
 if(!png.subarray(0,8).equals(signature))throw Error('Invalid PNG signature '+date);
 const text=Buffer.from('Marine7Render\0'+renderId+'|'+date,'latin1');
 const type=Buffer.from('tEXt','ascii');
 const len=Buffer.alloc(4);len.writeUInt32BE(text.length);
 const crc=Buffer.alloc(4);crc.writeUInt32BE(pngCrc32(Buffer.concat([type,text])));
 const chunk=Buffer.concat([len,type,text,crc]);
 const iend=png.length-12;
 if(iend<8||png.readUInt32BE(iend)!==0||png.toString('ascii',iend+4,iend+8)!=='IEND')throw Error('PNG missing final IEND '+date);
 return Buffer.concat([png.subarray(0,iend),chunk,png.subarray(iend)]);
}
const feed=await getFeed();validate(feed);await mkdir(root,{recursive:true});
// Render all seven before touching any published file; validation failures preserve previous posters.
const outputs=[];
for(const d of feed.days){
 const png=stampPng(await sharp(Buffer.from(graphicalPoster(d))).png({compressionLevel:8}).toBuffer(),d.date);
 const m=await sharp(png).metadata();if(m.width!==1080||m.height!==1560||png.length<15000)throw Error('Invalid rendered PNG '+d.date);
 const sites=['maiden','bowditch','california'].map(id=>d.locations.find(s=>s.id===id));
 const info={date:d.date,offset:d.dayOffset,outlook:d.outlook,source:feed.source,generatedAt:new Date().toISOString(),locations:sites.map(s=>({id:s.id,status:s.status,score:s.score,conditionLabel:s.conditionLabel,windKn:s.windKn,gustKn:s.gustKn,waveM:s.waveM,peakWaveM:s.peakWaveM,wavePeriodS:s.wavePeriodS,rainMm:s.rainMm,rainProbabilityPct:s.rainProbabilityPct,updatedAt:s.updatedAt})),sha256:createHash('sha256').update(png).digest('hex')};
 outputs.push({d,png,info});
}
for(const {d,png,info} of outputs){
 const stem=test?d.date:'seven-day-'+d.date;
 const tmp=resolve(root,'.'+stem+'.tmp');await writeFile(tmp,png);await rename(tmp,resolve(root,stem+'.png'));
 await writeFile(resolve(root,stem+'.json'),JSON.stringify(info,null,2)+'\n');
 console.log('Rendered',stem,'from standardized master cache');
}
const manifest={generatedAt:new Date().toISOString(),source:feed.source,timezone:zone,days:outputs.map(({d})=>({date:d.date,offset:d.dayOffset,outlook:d.outlook,image:(test?'':'instagram/generated/')+(test?d.date:'seven-day-'+d.date)+'.png',status:d.locations.find(s=>s.id==='maiden').status,conditionLabel:d.locations.find(s=>s.id==='maiden').conditionLabel}))};
await writeFile(resolve(root,test?'manifest.json':'seven-day-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
