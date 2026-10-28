/**
 * Read-only pilot cache assembly. Prefer the published Apps Script snapshot;
 * fall back to committed banks/hourly JSON if the snapshot is unavailable.
 * Never invent values or request a new forecast from a provider.
 */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const endpoint=process.env.PILOT_SNAPSHOT_URL||'https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const keys=['maiden','bowditch','california'];
const parts=d=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(d).filter(p=>['year','month','day','hour'].includes(p.type)).map(p=>[p.type,p.value]));
const iso=p=>`${p.year}-${p.month}-${p.day}`;
const local=parts(new Date());
const startUTC=new Date(Date.UTC(+local.year,+local.month-1,+local.day,12));
if(+local.hour<4)startUTC.setUTCDate(startUTC.getUTCDate()-1);
const first=iso(parts(startUTC));startUTC.setUTCDate(startUTC.getUTCDate()+1);const second=iso(parts(startUTC));
const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fields=['avgWindKn','peakGustKn','windDirMeanDeg','avgWaveM','peakWaveM','avgWavePeriodS','swellDirDeg','avgCurrentKn','currentDirMeanDeg','precipSumMm','rainProbabilityPct','uvHourlyMax','temperatureC','weatherCode'];
function normalize(r,defaultDay){
 const m=r.metrics||r, raw=r.hour??r.time??m.hour??m.time;
 const match=String(raw??'').match(/(?:T|\b)(\d{1,2}):(?:\d{2})/);
 const hour=match?+match[1]:Number.isInteger(+raw)&&String(raw??'').trim()!==''?+raw:NaN;
 if(!Number.isInteger(hour)||hour<0||hour>23)return null;
 const explicitDate=String(r.day||r.date||'').slice(0,10);
 const timestampDate=/^\d{4}-\d{2}-\d{2}T/.test(String(raw||''))?String(raw).slice(0,10):'';
 const day=explicitDate||timestampDate||String(defaultDay||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const out={day,time:String(hour).padStart(2,'0')+':00'};
 for(const f of fields)out[f]=numeric(m[f]);
 out.conditionColor=String(m.conditionColor||m.statusColor||'');
 return out;
}
async function snapshot(key,day){
 const url=new URL(endpoint);
 url.searchParams.set('action','snapshot');url.searchParams.set('key',key);url.searchParams.set('day',day);
 const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Snapshot unavailable');
 const payload=await response.json();
 if(!Array.isArray(payload.hours))throw Error('Snapshot has no hourly array');
 return {hours:payload.hours,day:payload.day||day,published_at:payload.published_at,version:payload.version,source:'published snapshot'};
}
async function localFiles(key){
 const out=[];
 for(const period of ['current','tomorrow']){
  try{const j=JSON.parse(await readFile(`banks/hourly/${key}-${period}.json`,'utf8'));
    if(Array.isArray(j.hours))out.push({...j,source:`banks/hourly/${key}-${period}.json`});
  }catch(e){if(e.code!=='ENOENT')console.warn(key,period,e.message);}
 }
 return out;
}
await mkdir('pilot/cache',{recursive:true});
for(const key of keys){
 const sources=[];
 for(const day of [first,second]){
  try{const result=await snapshot(key,day);sources.push(result);console.log(`${key} ${day}: published snapshot returned ${result.hours.length} rows`);}
  catch(e){console.warn(`${key} ${day}: ${e.message}; checking repository cache`);}
 }
 // Repository snapshots are supplemental; published endpoint records take priority.
 const localSources=await localFiles(key);
 const map=new Map();
 for(const source of [...localSources,...sources]){
  for(const raw of source.hours){
   const r=normalize(raw,source.day);
   if(r)map.set(r.day+'T'+r.time,r);
  }
 }
 const hours=[];
 for(let i=0;i<24;i++){
  const h=(4+i)%24,day=i<20?first:second,time=String(h).padStart(2,'0')+':00';
  hours.push(map.get(day+'T'+time)||{day,time,available:false});
 }
 const count=hours.filter(h=>h.available!==false).length;
 const missing=hours.filter(h=>h.available===false).map(h=>`${h.day} ${h.time}`);
 if(missing.length)console.warn(`${key}: published data missing ${missing.join(', ')}`);
 if(process.env.PILOT_REQUIRE_24H==='1' && missing.length)throw Error(`${key}: ${count}/24 records; refusing to publish partial forecast. Confirm action=snapshot returns full day rows for both ${first} and ${second}.`);
 if(count===0)throw Error(`${key}: no cached hours for ${first} 04:00–${second} 04:00; refusing to publish misleading charts`);
 const latest=[...localSources,...sources].map(s=>s.published_at).filter(Boolean).sort().at(-1)||null;
 await writeFile(`pilot/cache/${key}-24h.json`,JSON.stringify({key,day:first,through:second,window:'04:00–04:00 Jamaica time',closing_time:second+'T04:00',published_at:latest,version:sources.at(-1)?.version||null,hours},null,2));
 console.log(`${key}: ${count}/24 real hourly records; ${24-count} explicitly unavailable`);
}
