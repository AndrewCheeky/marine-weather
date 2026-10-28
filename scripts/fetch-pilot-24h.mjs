/**
 * Read-only pilot cache assembly. Prefer the published Apps Script snapshot;
 * fall back to committed banks/hourly JSON if the snapshot is unavailable.
 * Never invent values or request a new forecast from a provider.
 */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createSign} from 'node:crypto';
const endpoint=process.env.PILOT_SNAPSHOT_URL||'https://script.google.com/macros/s/AKfycbzwP_tF1SeJIBgB7HxTRBi374NiF0tQXGcSBFUk7EPPu1rSAepDsALW-iHeny6yo1Y/exec';
const keys=['maiden','bowditch','california'];
const sheetId=process.env.PILOT_SHEET_ID||'1JA-38rcUE6yudktWxqHf9ijZtlX9pfLYbDocLKQmHpA';
const parts=d=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(d).filter(p=>['year','month','day','hour'].includes(p.type)).map(p=>[p.type,p.value]));
const iso=p=>`${p.year}-${p.month}-${p.day}`;
const local=parts(new Date());
const startUTC=new Date(Date.UTC(+local.year,+local.month-1,+local.day,12));
if(+local.hour<4)startUTC.setUTCDate(startUTC.getUTCDate()-1);
const first=iso(parts(startUTC));startUTC.setUTCDate(startUTC.getUTCDate()+1);const second=iso(parts(startUTC));
const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fields=['avgWindKn','peakGustKn','windDirMeanDeg','avgWaveM','peakWaveM','avgWavePeriodS','swellDirDeg','avgCurrentKn','currentDirMeanDeg','precipSumMm','rainProbabilityPct','uvHourlyMax','temperatureC','weatherCode'];
const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
function normalize(r,defaultDay){
 const m=r.metrics||r, raw=r.hour??r.time??m.hour??m.time;
 const str=String(raw??'').trim();
 let day=String(r.day||r.date||'').slice(0,10),hour;
 const stamped=str.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
 if(stamped){
  if(stamped[4]){
   const d=new Date(str.replace(' ','T'));
   if(Number.isNaN(+d))return null;
   const p=parts(d);day=iso(p);hour=+p.hour;
  }else{day=stamped[1];hour=+stamped[2];}
 }else if(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(str))hour=+str.split(':')[0];
 else if(/^\d{1,2}$/.test(str))hour=+str;
 else return null;
 if(!Number.isInteger(hour)||hour<0||hour>23)return null;
 if(!day)day=String(defaultDay||'').slice(0,10);
 if(!dateOK(day))return null;
 const out={day,time:String(hour).padStart(2,'0')+':00'};
 for(const f of fields)out[f]=numeric(m[f]);
 if(out.swellDirDeg===null)out.swellDirDeg=numeric(m.swellDirectionDeg??m.swellDirMeanDeg);
 out.conditionColor=String(m.conditionColor||m.statusColor||'');
 if(!fields.some(f=>out[f]!==null))return null;
 return out;
}
// Google service account must have Viewer access to the spreadsheet. Read only.
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
async function sheetAccessToken(){
 const credential=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
 if(!credential.client_email||!credential.private_key)throw Error('Service-account JSON missing email or private key');
 const now=Math.floor(Date.now()/1000);
 const head=b64({alg:'RS256',typ:'JWT'}),body=b64({iss:credential.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500});
 const signer=createSign('RSA-SHA256');signer.update(head+'.'+body);signer.end();
 const assertion=head+'.'+body+'.'+signer.sign(credential.private_key,'base64url');
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Google Sheets authorization failed (${response.status})`);
 const data=await response.json();return data.access_token;
}
async function sheetWindows(){
 if(!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)return null;
 const token=await sheetAccessToken();
 const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('Forecast24h!A1:H1000')}`;
 const response=await fetch(url,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Forecast24h sheet read failed (${response.status})`);
 const data=await response.json();const rows=data.values||[];
 const headers=rows.shift()||[];const idx=Object.fromEntries(headers.map((h,i)=>[h,i]));
 for(const required of ['location_key','window_start','window_end','hours_json'])if(idx[required]===undefined)throw Error(`Forecast24h missing column ${required}`);
 const windows=[];
 for(const row of rows){
  if(!row[idx.hours_json])continue;
  try{
   const hours=JSON.parse(row[idx.hours_json]);if(!Array.isArray(hours))continue;
   windows.push({key:row[idx.location_key],start:row[idx.window_start],end:row[idx.window_end],hours,published_at:row[idx.published_at],version:row[idx.version],source:'Forecast24h sheet'});
  }catch(e){console.warn(`Invalid Forecast24h hours_json: ${e.message}`);}
 }
 console.log(`Forecast24h sheet: ${windows.length} parsed windows`);
 return windows;
}
async function snapshot(key,day){
 const url=new URL(endpoint);
 url.searchParams.set('action','snapshot');url.searchParams.set('key',key);url.searchParams.set('day',day);
 const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Snapshot unavailable');
 const payload=await response.json();
 if(!Array.isArray(payload.hours))throw Error('Snapshot has no hourly array');
 const days=[...new Set(payload.hours.map(r=>normalize(r,payload.day||day)?.day).filter(Boolean))];
 console.log(`${key} ${day}: snapshot declared=${payload.day||'none'} rows=${payload.hours.length} normalizedDays=${days.join(',')||'none'} usable=${payload.hours.filter(r=>normalize(r,payload.day||day)).length}`);
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
const sheetRows=await sheetWindows();
for(const key of keys){
 const sources=[];
 const exact=sheetRows?.filter(w=>w.key===key&&w.start===`${first} 04:00`&&w.end===`${second} 04:00`)||[];
 if(exact.length){const selected=exact.sort((a,b)=>String(b.published_at).localeCompare(String(a.published_at)))[0];sources.push({...selected,day:first});console.log(`${key}: authoritative Forecast24h window contains ${selected.hours.length} raw records`);}
 if(!exact.length)for(const day of [first,second]){
  try{const result=await snapshot(key,day);sources.push(result);console.log(`${key} ${day}: published snapshot returned ${result.hours.length} rows`);}
  catch(e){console.warn(`${key} ${day}: ${e.message}; checking repository cache`);}
 }
 // Repository snapshots are supplemental; published endpoint records take priority.
 const localSources=await localFiles(key);
 const map=new Map();
 const priority=new Map();
 for(const source of [...localSources,...sources]){
  for(const raw of source.hours){
   const r=normalize(raw,source.day);
   if(r){const id=r.day+'T'+r.time; const rank=source.source==='Forecast24h sheet'?3:source.source==='published snapshot'?2:1; if((priority.get(id)||0)<=rank){map.set(id,r);priority.set(id,rank);}}
  }
 }
 const hours=[];
 for(let i=0;i<24;i++){
  const h=(4+i)%24,day=i<20?first:second,time=String(h).padStart(2,'0')+':00';
  hours.push(map.get(day+'T'+time)||{day,time,available:false});
 }
 const essential=['avgWindKn','peakGustKn','avgWaveM','avgWavePeriodS'];
 for(const h of hours)if(h.available!==false&&essential.some(f=>h[f]===null)){console.warn(`${key} ${h.day} ${h.time}: missing essential metrics`);h.available=false;}
 const count=hours.filter(h=>h.available!==false).length;
 const missing=hours.filter(h=>h.available===false).map(h=>`${h.day} ${h.time}`);
 if(missing.length)console.warn(`${key}: published data missing ${missing.join(', ')}`);
 if(process.env.PILOT_REQUIRE_24H==='1' && missing.length)throw Error(`${key}: ${count}/24 records; refusing to publish partial forecast. Confirm Forecast24h contains a complete ${first} 04:00–${second} 04:00 window.`);
 if(count===0)throw Error(`${key}: no cached hours for ${first} 04:00–${second} 04:00; refusing to publish misleading charts`);
 const latest=[...localSources,...sources].map(s=>s.published_at).filter(Boolean).sort().at(-1)||null;
 await writeFile(`pilot/cache/${key}-24h.json`,JSON.stringify({key,day:first,through:second,window:'04:00–04:00 Jamaica time',closing_time:second+'T04:00',published_at:latest,version:sources.at(-1)?.version||null,hours},null,2));
 console.log(`${key}: ${count}/24 real hourly records; ${24-count} explicitly unavailable`);
}
