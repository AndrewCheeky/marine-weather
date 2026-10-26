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
 const d=p.poster||{};
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
 ${rr(680,25,365,136,'#062c4b',18)}${t(706,68,'DAILY MARINE OUTLOOK',25,white,850)}${t(706,108,p.day,30,yellow,900)}${t(706,140,'07:00–17:00  JAMAICA',19,white,750)}
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
  console.log(`SUCCESS: ${payload.day}, ${png.length} bytes, Sharp 1080x1350, verified cached forecast`);process.exit(0);
 }catch(e){last=e;console.error(`Attempt ${attempt}/3: ${e.message}`);if(attempt<3)await new Promise(r=>setTimeout(r,2500));}
}
console.error('Forecast graphic not regenerated; existing PNG preserved.',last?.message);process.exit(1);
