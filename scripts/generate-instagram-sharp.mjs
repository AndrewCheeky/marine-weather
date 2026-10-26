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
 const [sc,sl,word]=theme(val(d,'status','AMBER'));
 const W=1080,H=1600;
 const white='#ffffff',ink='#082d4b',navy='#062d4c',blue='#075c91',yellow='#ffd22f';
 const t=(x,y,value,size=26,color=ink,weight=700,extra='')=>label(x,y,value,size,color,weight,extra);
 const rr=(x,y,w,h,c,r=18)=>rect(x,y,w,h,c,r);
 const field=(x,y,k,v)=>`${t(x,y,k,20,'#55758a',750)}${t(x,y+43,truncate(v,24),29,ink,850)}`;
 const section=(x,y,w,h,title)=>`${rr(x,y,w,h,white,19)}${rr(x,y,w,55,navy,15)}${t(x+22,y+37,title,25,white,850)}`;
 const bank=(x,n)=>{
   const [c,b,w]=theme(val(d,`bank${n}status`,'AMBER'));
   return `${section(x,680,510,365,truncate(val(d,`bank${n}`,'BANK'),26))}
   ${rr(x+16,751,478,74,b,12)}${t(x+31,803,w,43,c,900)}
   ${t(x+20,859,'BANK OUTLOOK',19,'#4f6f85',800)}
   ${t(x+20,896,truncate(val(d,`bank${n}detail`),35),23,ink,700)}
   ${t(x+20,946,'RAIN / CONDITIONS',19,'#4f6f85',800)}
   ${t(x+20,984,truncate(val(d,`bank${n}rain`),37),22,ink,700)}`;
 };
 const tides=val(d,'highTides','—'),low=val(d,'lowTides','—');
 const moon=val(d,'moonPhase','—'),illum=val(d,'moonIllum','—');
 const validMoon=moon!=='—';
 const photoData=globalThis.__marineHeaderPhoto||'';
 const photo=photoData?`<image href="${photoData}" x="0" y="0" width="1080" height="392" preserveAspectRatio="xMidYMid slice"/>`:'';
 const preview=p.preview===true;
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
 <defs><linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#002746" stop-opacity=".88"/><stop offset="1" stop-color="#004977" stop-opacity=".38"/></linearGradient><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d5ecf5"/><stop offset="1" stop-color="#e9f3f8"/></linearGradient></defs>
 ${rr(0,0,W,H,'url(#bg)',0)}${rr(0,0,W,392,'#08618b',0)}${photo}${rr(0,0,W,392,'url(#overlay)',0)}
 ${t(34,81,'MARINE WEATHER',65,white,900)}${t(34,187,'JAMAICA',115,yellow,900)}
 ${t(38,246,'FISHING  •  BOATING  •  EXPLORING',25,white,800)}
 ${rr(620,272,426,106,'#062c4b',18)}${t(643,306,'DAILY MARINE OUTLOOK',23,white,850)}${t(643,338,p.day,27,yellow,900)}${t(643,365,'07:00–17:00 JAMAICA',17,white,750)}
 ${rr(16,412,1048,244,white,20)}${t(40,460,'OVERALL MARINE CONDITIONS',29,ink,900)}
 ${rr(38,482,327,78,sl,13)}${t(62,538,word,46,sc,900)}
 ${t(389,515,truncate(val(d,'condition'),34),24,ink,800)}${t(389,551,`COMFORT  ${val(d,'comfort')}`,22,'#47728e',800)}
 <line x1="38" y1="575" x2="1040" y2="575" stroke="#d7e6ed" stroke-width="2"/>
 ${field(48,603,'WIND / GUSTS',[val(d,'wind'),val(d,'gust')].filter(v=>v!=='—').join(' / ')||'—')}
 ${field(398,603,'SEAS',val(d,'seas'))}${field(735,603,'RAIN',val(d,'rain'))}
 ${bank(16,1)}${bank(554,2)}
 ${section(16,1063,510,227,'TIDES  ·  KINGSTON')}${t(37,1150,'HIGH',21,'#387b8f',800)}${t(158,1150,truncate(tides,23),24,ink,850)}
 ${t(37,1222,'LOW',21,'#387b8f',800)}${t(158,1222,truncate(low,23),24,ink,850)}
 ${section(554,1063,510,227,'MOON PHASE')}${t(580,1150,truncate(moon,27),28,ink,850)}${t(580,1218,`ILLUMINATION  ${illum}`,22,'#47728e',750)}
 ${section(16,1308,1048,141,'OTHER CONDITIONS')}${field(41,1387,'CURRENT',`${val(d,'current')} ${val(d,'currentDir','')}`)}${field(392,1387,'SEA TEMPERATURE',val(d,'sst'))}${field(748,1387,'UV INDEX',val(d,'uv'))}
 ${rr(16,1468,1048,116,navy,18)}${t(42,1516,'⚠  FORECAST GUIDANCE ONLY',29,yellow,900)}${t(42,1551,'Verify official marine advisories. Not for navigation.',22,white,700)}
 ${preview?`${t(230,830,'ILLUSTRATIVE MOCK DATA',48,'#e74444',900,'transform="rotate(-24 230 830)"')}`:''}
 </svg>`;
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
