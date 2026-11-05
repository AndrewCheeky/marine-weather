import sharp from 'sharp';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
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
 if(!feed?.ok||feed.source!=='Marine7DayCache'||feed.schemaVersion!=='marine7-cache-only-v3'||feed.comfortScoreVersion!=='v3'||feed.timezone!==zone||feed.days?.length!==7)throw Error('Unexpected master-cache schema');
 const all=new Set(),sites=new Set(),now=Date.now(),maxAge=24*3600*1000;
 feed.days.forEach((d,i)=>{
  if(d.date!==plus(today(),i)||d.dayOffset!==i||!d.ready||d.locations?.length!==14)throw Error('Missing/old forecast day '+i);
  d.locations.forEach(s=>{
   const id=d.date+'|'+s.id;if(all.has(id))throw Error('Duplicate '+id);all.add(id);sites.add(s.id);
   if(!s.ready||s.stale||s.scoreVersion!=='v3'||!['GREEN','YELLOW','AMBER','RED'].includes(s.status)||!s.conditionLabel?.trim()||!Number.isFinite(s.score))throw Error('Missing cached v3 status '+id);
   for(const k of ['windKn','gustKn','waveM','peakWaveM','wavePeriodS','rainMm','rainProbabilityPct'])if(!Number.isFinite(s[k]))throw Error('Missing '+k+' '+id);
   if(s.rainProbabilityPct<0||s.rainProbabilityPct>100)throw Error('Invalid rainfall probability '+id);
   for(const k of ['updatedAt','cacheBuiltAt']){const t=Date.parse(s[k]);if(!Number.isFinite(t)||t>now+300000||now-t>maxAge)throw Error('Stale '+k+' '+id);}
  });
 });
 if(all.size!==98||sites.size!==14)throw Error('Master cache must contain 98 unique location-day records');
 for(const id of ['maiden','bowditch','california'])if(!sites.has(id))throw Error('Missing poster location '+id);
}
function render(day){
 const dateLabel=new Intl.DateTimeFormat('en-JM',{timeZone:'UTC',dateStyle:'full'}).format(new Date(day.date+'T12:00:00Z'));
 const names={maiden:'KINGSTON / MAIDEN CAY',bowditch:'MACKEREL (BOWDITCH)',california:'CALIFORNIA BANK'};
 const sites=['maiden','bowditch','california'].map(id=>day.locations.find(s=>s.id===id));
 let rows='';sites.forEach((s,i)=>{
  const y=315+i*347,accent=color(s.status),line=(dy,l,r)=>txt(72,y+dy,l,22,'#b8d9e9')+txt(600,y+dy,r,25);
  rows+=box(45,y,990,325,'#10354d')+box(45,y,12,325,accent)+txt(72,y+47,names[s.id],28)+txt(690,y+47,`${s.status} · ${fmt(s.score,1)}`,24,accent,800)
    +txt(72,y+86,s.conditionLabel,24,'#fff',700)
    +line(132,'Wind / peak gust',`${fmt(s.windKn)} / ${fmt(s.gustKn)} kn`)
    +line(178,'Waves / peak waves',`${fmt(s.waveM)} / ${fmt(s.peakWaveM)} m`)
    +line(224,'Wave period',`${fmt(s.wavePeriodS)} s`)
    +line(270,'Rain / probability',`${fmt(s.rainMm)} mm / ${fmt(s.rainProbabilityPct,0)}%`);
 });
 const oldest=Math.min(...sites.map(s=>Date.parse(s.updatedAt)));
 const stamp=new Intl.DateTimeFormat('en-JM',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(oldest));
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1560" viewBox="0 0 1080 1560">${box(0,0,1080,1560,'#061d30')}${txt(48,85,'JAMAICA MARINE WEATHER',43,'#fff',900)}${txt(48,137,day.dayOffset<3?'SHORT-RANGE FORECAST':'EXTENDED OUTLOOK · GREATER UNCERTAINTY',25,'#f7c978')}${txt(48,207,dateLabel,38)}${txt(48,257,'7:00 AM – 5:00 PM · JAMAICA TIME',25,'#b8d9e9')}${rows}${box(45,1382,990,145,'#10354d')}${txt(65,1422,'Cache updated: '+stamp,22)}${txt(65,1461,'Comfort is not a boating safety clearance.',21,'#fce8a0')}${txt(65,1498,'Check official marine warnings · Not for navigation',21,'#fce8a0')}</svg>`;
}
const feed=await getFeed();validate(feed);await mkdir(root,{recursive:true});
// Render all seven before touching any published file; validation failures preserve previous posters.
const outputs=[];
for(const d of feed.days){
 const png=await sharp(Buffer.from(render(d))).png({compressionLevel:8}).toBuffer();
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
