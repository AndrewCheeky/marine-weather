/** Read-only: fetch two Jamaica calendar days from the existing Apps Script snapshot cache endpoint. */
import {mkdir,writeFile} from 'node:fs/promises';
const endpoint='https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const locations=['maiden','bowditch','california'];
const tz='America/Jamaica';
const localParts=(date)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(x=>['year','month','day','hour'].includes(x.type)).map(x=>[x.type,x.value]));
const ymd=p=>`${p.year}-${p.month}-${p.day}`;
const now=new Date();const parts=localParts(now);
// Before 04:00 local time, the most recent 04:00 start was yesterday.
const anchor=new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day,12));
if(+parts.hour<4)anchor.setUTCDate(anchor.getUTCDate()-1);
const first=ymd(localParts(anchor));anchor.setUTCDate(anchor.getUTCDate()+1);const second=ymd(localParts(anchor));
const dates=[first,second];
const str=(v)=>v==null?'':String(v);
const val=(v)=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
function hourNum(v){const h=Number(String(v).split(':')[0]);return Number.isInteger(h)&&h>=0&&h<24?h:null;}
function metricsToRow(record){const m=record.metrics||{},hour=hourNum(record.hour??m.hour);if(!record.day||hour===null)return null;
 return {day:record.day,time:String(hour).padStart(2,'0')+':00',avgWindKn:val(m.avgWindKn),peakGustKn:val(m.peakGustKn),windDirMeanDeg:val(m.windDirMeanDeg),avgWaveM:val(m.avgWaveM),avgWavePeriodS:val(m.avgWavePeriodS),peakWaveM:val(m.peakWaveM??m.maxWaveM),swellDirDeg:val(m.swellDirDeg??m.swellDirectionDeg),temperatureC:val(m.temperatureC??m.airTemperatureC),weatherCode:val(m.weatherCode),avgCurrentKn:val(m.avgCurrentKn),currentDirMeanDeg:val(m.currentDirMeanDeg),precipSumMm:val(m.precipSumMm),rainProbabilityPct:val(m.rainProbabilityPct),uvHourlyMax:val(m.uvHourlyMax),conditionColor:str(m.conditionColor||m.statusColor)};}
async function fetchDay(key,day){const url=new URL(endpoint);url.searchParams.set('action','snapshot');url.searchParams.set('key',key);url.searchParams.set('day',day);const res=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(25000)});if(!res.ok)throw Error(`Snapshot request failed for ${key} ${day}`);const json=await res.json();if(!Array.isArray(json.hours)||!json.version)throw Error(`Invalid snapshot for ${key} ${day}`);return json;}
await mkdir('pilot/cache',{recursive:true});
for(const key of locations){const results=await Promise.all(dates.map(d=>fetchDay(key,d)));const all=new Map();for(const result of results){for(const record of result.hours){const row=metricsToRow(record);if(row)all.set(row.day+'T'+row.time,row);}}
 const hours=[];for(let i=0;i<24;i++){const day=i<20?first:second,h=(4+i)%24,stamp=day+'T'+String(h).padStart(2,'0')+':00';hours.push(all.get(stamp)||{day,time:String(h).padStart(2,'0')+':00',available:false});}
 const present=hours.filter(r=>r.available!==false).length;if(!present)throw Error(`No cached hours for ${key}; refusing to replace existing pilot graphics`);
 const payload={key,day:first,through:second,window:'04:00–04:00 Jamaica time',source:'Existing Apps Script published snapshot cache',published_at:results.map(x=>x.published_at).filter(Boolean).sort().at(-1)||null,versions:results.map(x=>x.version),hours};
 await writeFile(`pilot/cache/${key}-24h.json`,JSON.stringify(payload,null,2));console.log(`${key}: ${present}/24 actual cached hourly records (${first} 04:00 to ${second} 04:00)`);
}
