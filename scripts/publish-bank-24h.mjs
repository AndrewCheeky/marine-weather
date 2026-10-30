/** Publish read-only, real hourly forecast rows from Forecast24h for all banks.
 * Requires GOOGLE_SERVICE_ACCOUNT_JSON; never requests new provider forecasts.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createSign} from 'node:crypto';
const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'null');
if(!credentials?.client_email||!credentials?.private_key)throw Error('GOOGLE_SERVICE_ACCOUNT_JSON secret is required');
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const now=Math.floor(Date.now()/1000),header=b64({alg:'RS256',typ:'JWT'}),claims=b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500});
const signer=createSign('RSA-SHA256');signer.update(header+'.'+claims);signer.end();
const assertion=header+'.'+claims+'.'+signer.sign(credentials.private_key,'base64url');
const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(20000)});
if(!auth.ok)throw Error('Google Sheets authentication failed: '+auth.status);
const token=(await auth.json()).access_token;
const sheetId=process.env.PILOT_SHEET_ID||'1JA-38rcUE6yudktWxqHf9ijZtlX9pfLYbDocLKQmHpA';
const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('Forecast24h!A1:H2000')}`;
const response=await fetch(url,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Forecast24h sheet read failed: '+response.status);
const lines=(await response.json()).values||[],headers=lines.shift()||[],ix=Object.fromEntries(headers.map((x,i)=>[x,i]));
for(const h of ['location_key','hours_json','published_at'])if(ix[h]===undefined)throw Error('Missing Forecast24h header '+h);
const banks=JSON.parse(await readFile('banks/banks.json','utf8'));
const keys=new Set(banks.map(b=>b.key));
const map=new Map(),numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fields=['avgWindKn','peakGustKn','avgWaveM','avgWavePeriodS','avgCurrentKn','rainProbabilityPct','temperatureC','uvHourlyMax','windDirMeanDeg','swellDirDeg'];
for(const row of lines){const key=row[ix.location_key];if(!keys.has(key))continue;let hours;
 try{hours=JSON.parse(row[ix.hours_json]);}catch{continue;}if(!Array.isArray(hours))continue;
 const published=row[ix.published_at]||'';
 for(const h of hours){const day=String(h.day||'').slice(0,10),hour=String(h.hour??'').padStart(2,'0');if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^([01]\d|2[0-3])$/.test(hour)||!h.metrics)continue;
  const stamp=day+'T'+hour+':00',id=key+'|'+stamp,prior=map.get(id);
  if(prior&&prior.published_at>published)continue;
  const metrics={};for(const f of fields)metrics[f]=numeric(h.metrics[f]);
  if(!fields.some(f=>metrics[f]!==null))continue;
  map.set(id,{day,hour,time:hour+':00',stamp,metrics,published_at:published});
 }
}
await mkdir('banks/hourly',{recursive:true});
const nowParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(p=>['year','month','day','hour'].includes(p.type)).map(p=>[p.type,p.value]));
const start=`${nowParts.year}-${nowParts.month}-${nowParts.day}T${nowParts.hour}:00`;
for(const b of banks){const hours=[...map.entries()].filter(([id,r])=>id.startsWith(b.key+'|')&&r.stamp>=start).map(([,r])=>r).sort((a,b)=>a.stamp.localeCompare(b.stamp)).slice(0,48);
 const out={key:b.key,source:'Forecast24h',generated_at:new Date().toISOString(),hours};
 await writeFile(`banks/hourly/${b.key}-24h.json`,JSON.stringify(out));
 console.log(b.key+': '+hours.length+' future hourly records published');
}
