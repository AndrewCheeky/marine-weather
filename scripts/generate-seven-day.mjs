import sharp from 'sharp';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const endpoint=process.env.SEVEN_DAY_DATA_URL;
if(!endpoint)throw Error('SEVEN_DAY_DATA_URL GitHub secret is required; existing posters remain untouched');
const root=resolve('instagram/generated');
const ja='America/Jamaica';
const localDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:ja,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const num=(v,d=1)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'Unavailable';
const val=(v,u,d=1)=>typeof v==='number'&&Number.isFinite(v)?`${v.toFixed(d)} ${u}`:'Unavailable';
const label=(x,y,s,size=28,color='#fff',weight=600)=>`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(s)}</text>`;
const rect=(x,y,w,h,color,r=20)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;
const shortDate=d=>new Intl.DateTimeFormat('en-JM',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric',year:'numeric'}).format(new Date(d+'T12:00:00Z'));
async function fetchFeed(){
 const callback='mwInstagramCallback_'+Date.now()+'_1';
 const url=new URL(endpoint);url.searchParams.set('action','sevenDayData');url.searchParams.set('callback',callback);
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),65000);
 try{
  const res=await fetch(url,{signal:ctrl.signal});if(!res.ok)throw Error('Seven-day feed unavailable');
  const body=(await res.text()).trim();const prefix=callback+'(';
  if(!body.startsWith(prefix)||!body.endsWith(');'))throw Error('Unexpected seven-day feed format; deploy Apps Script dispatch');
  const data=JSON.parse(body.slice(prefix.length,-2));
  if(!data.ok||!Array.isArray(data.days)||data.days.length!==7)throw Error('Seven-day feed incomplete');
  if(data.timezone!==ja)throw Error('Incorrect forecast timezone');
  if(data.days[0].date!==localDate())throw Error('Seven-day feed dates are not current in Jamaica');
  return data;
 }finally{clearTimeout(timer);}
}
function render(day,feed){
 const extended=day.dayOffset>=3,accent=extended?'#f59e0b':'#16a34a';
 const locations=['maiden','bowditch','california'].map(id=>day.locations.find(x=>x.id===id));
 if(locations.some(x=>!x||!x.ready||x.stale))throw Error(`Day ${day.date} contains missing/stale data`);
 // No inferred condition colour or comfort score; source may use a different scoring policy.
 const rows=locations.map((s,i)=>{
  const y=335+i*342;
  const title=i===0?'KINGSTON / MAIDEN CAY':i===1?'MACKEREL (BOWDITCH)':'CALIFORNIA BANK';
  const line=(yy,l,r)=>label(72,yy,l,23,'#b7d6e7',600)+label(620,yy,r,27,'#fff',700);
  return `${rect(45,y,990,316,'#10354d')}${rect(45,y,10,316,accent,0)}${label(72,y+48,title,29,'#fff',800)}
  ${line(y+101,'Wind (average) / peak gust',`${val(s.windKn,'kn')} / ${val(s.gustKn,'kn')}`)}
  ${line(y+150,'Waves (average) / peak',`${val(s.waveM,'m')} / ${val(s.peakWaveM,'m')}`)}
  ${line(y+199,'Wave period / swell',`${val(s.wavePeriodS,'s')} / ${val(s.swellM,'m')}`)}
  ${line(y+248,'Rain / maximum probability',`${val(s.rainMm,'mm')} / ${val(s.rainProbabilityPct,'%',0)}`)}
  ${line(y+293,'Sea temperature / current',`${val(s.sstC,'°C')} / ${num(s.currentVelocity,2)} (raw)`)}`;
 }).join('');
 const fresh=locations.map(s=>new Date(s.updatedAt).getTime()).filter(Number.isFinite);
 const stamp=fresh.length?new Intl.DateTimeFormat('en-JM',{timeZone:ja,dateStyle:'medium',timeStyle:'short'}).format(new Date(Math.min(...fresh))):'Not available';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1560" viewBox="0 0 1080 1560">
 ${rect(0,0,1080,1560,'#061d30',0)}${rect(0,0,1080,20,accent,0)}
 ${label(48,94,'JAMAICA MARINE WEATHER',45,'#fff',900)}
 ${rect(48,128,984,66,accent,12)}${label(70,173,extended?'EXTENDED OUTLOOK · DAYS 4–7':'SHORT-RANGE FORECAST · DAYS 1–3',29,'#fff',850)}
 ${label(48,249,shortDate(day.date),39,'#fff',800)}
 ${label(48,296,'7:00 AM – 5:00 PM · JAMAICA TIME',25,'#b7d6e7',700)}
 ${rows}
 ${rect(45,1381,990,146,'#10354d')}
 ${label(66,1424,`Forecast updated: ${stamp}`,21,'#d8edf8',600)}
 ${label(66,1460,extended?'Extended forecasts carry greater uncertainty.':'Conditions may change. Check updates before departure.',21,'#fff',650)}
 ${label(66,1496,'Check official marine warnings · Not for navigation',21,'#fce8a0',700)}
 </svg>`;
}
await mkdir(root,{recursive:true});
const feed=await fetchFeed();let failures=[];
for(const day of feed.days){
 try{
  if(day.dayOffset<0||day.dayOffset>6||!day.ready)throw Error('Incomplete day');
  const png=await sharp(Buffer.from(render(day,feed))).png({compressionLevel:8}).toBuffer();
  const meta=await sharp(png).metadata();if(meta.width!==1080||meta.height!==1560||png.length<20000)throw Error('Invalid poster');
  const base=`seven-day-${day.date}`;const tmp=resolve(root,`.${base}.tmp`);
  await writeFile(tmp,png);await rename(tmp,resolve(root,base+'.png'));
  await writeFile(resolve(root,base+'.json'),JSON.stringify({date:day.date,offset:day.dayOffset,outlook:day.outlook,generatedAt:new Date().toISOString(),sha256:createHash('sha256').update(png).digest('hex')},null,2)+'\n');
  console.log(`Published ${day.date} (${day.outlook})`);
 }catch(e){failures.push(day.date);console.error(`Preserved existing ${day.date} poster: ${e.message}`);}
}
if(failures.length)throw Error(`Incomplete publication: ${failures.join(', ')}. Check the read-only seven-day feed and confirm both weather and marine caches were refreshed with forecast_days=8. No incomplete seven-day manifest was published.`);
await writeFile(resolve(root,'seven-day-manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),timezone:ja,days:feed.days.filter(d=>!failures.includes(d.date)).map(d=>({date:d.date,offset:d.dayOffset,outlook:d.outlook,image:`instagram/generated/seven-day-${d.date}.png`}))},null,2)+'\n');
