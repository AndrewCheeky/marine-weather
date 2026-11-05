import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const src=resolve('instagram/seven-day-test');
const dst=resolve('instagram/generated');
const manifest=JSON.parse(await readFile(resolve(src,'manifest.json'),'utf8'));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plus=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
if(!Array.isArray(manifest.days)||manifest.days.length!==7)throw Error('Exactly seven test days required');
if(!Number.isFinite(Date.parse(manifest.generatedAt))||Date.now()-Date.parse(manifest.generatedAt)>3600000||Date.parse(manifest.generatedAt)>Date.now()+300000)throw Error('Test generation timestamp invalid or stale');
const staged=[];
for(let i=0;i<7;i++){
 const d=manifest.days[i],date=plus(today(),i);
 if(d.date!==date||d.offset!==i||!['GREEN','YELLOW','AMBER','RED'].includes(d.status))throw Error('Incomplete or stale test day '+i);
 if(d.image!==date+'.png')throw Error('Unexpected test image path');
 const png=await readFile(resolve(src,d.image));
 if(png.length<15000||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG '+date);
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 if(width!==1080||height!==1560)throw Error('Unexpected PNG dimensions '+date);
 const sidecar=JSON.parse(await readFile(resolve(src,date+'.json'),'utf8'));
 if(sidecar.date!==date||sidecar.sha256!==createHash('sha256').update(png).digest('hex'))throw Error('Test image checksum mismatch '+date);
 staged.push({date,png,sidecar,d});
}
await mkdir(dst,{recursive:true});
// All seven files validated before any live file is changed.
for(const {date,png,sidecar} of staged){
 const stem='seven-day-'+date;
 await writeFile(resolve(dst,'.'+stem+'.png.tmp'),png);
 await writeFile(resolve(dst,'.'+stem+'.json.tmp'),JSON.stringify(sidecar,null,2)+'\n');
}
for(const {date} of staged){
 const stem='seven-day-'+date;
 await rename(resolve(dst,'.'+stem+'.png.tmp'),resolve(dst,stem+'.png'));
 await rename(resolve(dst,'.'+stem+'.json.tmp'),resolve(dst,stem+'.json'));
}
const live={generatedAt:manifest.generatedAt,source:manifest.source,timezone:'America/Jamaica',days:staged.map(({date,d},i)=>({date,offset:i,outlook:i<3?'short-range':'extended',image:'instagram/generated/seven-day-'+date+'.png',status:d.status,conditionLabel:d.conditionLabel||''}))};
await writeFile(resolve(dst,'.seven-day-manifest.json.tmp'),JSON.stringify(live,null,2)+'\n');
await rename(resolve(dst,'.seven-day-manifest.json.tmp'),resolve(dst,'seven-day-manifest.json'));
console.log('Promoted seven validated test posters to live; existing daily poster unchanged');
