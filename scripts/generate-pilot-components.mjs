import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const banks=[['maiden','Maiden Cay'],['bowditch','Mackerel (Bowditch) Bank'],['california','California Bank']];
const out='pilot/generated';await mkdir(out,{recursive:true});
const W=1080,H=1350;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fmt=(v,d=1)=>n(v)===null?'—':n(v).toFixed(d);
const avg=(rows,k)=>{const v=rows.map(r=>n(r[k])).filter(v=>v!==null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
const sum=(rows,k)=>{const v=rows.map(r=>n(r[k])).filter(v=>v!==null);return v.length?v.reduce((a,b)=>a+b,0):null};
const max=(rows,k)=>{const v=rows.map(r=>n(r[k])).filter(v=>v!==null);return v.length?Math.max(...v):null};
const txt=(x,y,t,size=36,color='#fff',weight=600,extra='')=>`<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${esc(t)}</text>`;
const rect=(x,y,w,h,fill,rx=24,stroke='none')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;
const base=(name,day,title,inner)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#06253b"/><stop offset="1" stop-color="#0a4762"/></linearGradient><linearGradient id="sea" x2="1" y2="1"><stop stop-color="#127aa2"/><stop offset="1" stop-color="#06253b"/></linearGradient></defs>${rect(0,0,W,H,'url(#bg)',0)}${rect(0,0,W,16,'#17b4da',0)}${txt(54,80,'JAMAICA MARINE WEATHER',34,'#74e1f7',800)}${txt(54,148,title,54,'#fff',800)}${txt(54,206,name,33,'#cceaf3',600)}${txt(54,252,day+'  ·  JAMAICA TIME',25,'#9ec4d3',500)}${inner}${rect(35,1250,1010,2,'#32728b',0)}${txt(54,1295,'marine-weather.andrewcheeky.com',24,'#a9d7e7',600)}${txt(54,1324,'Forecast guidance only · Not for navigation · Check official advisories',19,'#b6c9d1',400)}</svg>`;
const compass=deg=>{const d=n(deg);return d===null?'—':['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((d%360)+360)%360/22.5)%16]};
const panel=(y,h)=>rect(40,y,1000,h,'#0b354c',26,'#266b86');
const metric=(x,y,label,value)=>rect(x,y,292,145,'#10445d',20)+txt(x+22,y+45,label,24,'#8ddbf1',600)+txt(x+22,y+111,value,42,'#fff',800);
function windowScore(rows){if(!rows.length)return null;const w=avg(rows,'avgWindKn'),g=max(rows,'peakGustKn'),s=max(rows,'avgWaveM'),p=avg(rows,'avgWavePeriodS');if([w,g,s].some(v=>v===null))return null;let score=100-Math.max(0,w-5)*3-Math.max(0,g-10)*2-Math.max(0,s-.6)*28-(p!==null&&p<5?10:0);const rain=max(rows,'rainProbabilityPct');if(rain!==null)score-=rain*.12;return Math.max(0,Math.min(100,Math.round(score)));}
function windows(hours){const pairs=[];for(let i=0;i<hours.length-1;i++){const r=hours.slice(i,i+2),score=windowScore(r);if(score!==null)pairs.push({start:r[0].time,end:r[1].time,score,rows:r});}return pairs.sort((a,b)=>b.score-a.score);}
// A fixed 24-hour Jamaica-time axis. Missing source hours remain gaps, never estimates.
function dayRows24(rows){
  const byHour=new Map();
  for(const row of rows){const m=String(row.time||'').match(/^(\d{2}):/);if(m&&Number(m[1])<24)byHour.set(Number(m[1]),row);}
  return Array.from({length:24},(_,h)=>({...byHour.get(h),time:String(h).padStart(2,'0')+':00',available:byHour.has(h)}));
}
function lineChart(rows,key,y,color,ceiling){
  const values=rows.map(r=>r.available?n(r[key]):null),valid=values.filter(v=>v!==null);
  const top=Math.max(ceiling,Math.ceil((valid.length?Math.max(...valid):ceiling)*1.15));
  const name=key==='avgWindKn'?'WIND (kn)':key==='avgWaveM'?'SEAS (m)':'RAIN PROBABILITY (%)';
  let s=txt(65,y-14,name,27,'#a6e7f8',700)+rect(65,y,950,220,'#092b40',15);
  const left=100,right=985,plotTop=y+18,plotBottom=y+152;
  for(let i=0;i<4;i++){const gy=plotTop+i*(plotBottom-plotTop)/3;s+=`<line x1="${left}" x2="${right}" y1="${gy}" y2="${gy}" stroke="#295d72"/>`;}
  const points=values.map((v,i)=>v===null?null:[left+i*(right-left)/23,plotBottom-(v/top)*(plotBottom-plotTop)]);
  let segment=[];
  for(let i=0;i<points.length;i++){
    if(points[i]){segment.push(points[i].join(','));s+=`<circle cx="${points[i][0]}" cy="${points[i][1]}" r="3.3" fill="${color}"/>`;}
    if((!points[i]||i===points.length-1)&&segment.length){
      if(segment.length>1)s+=`<polyline fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${segment.join(' ')}"/>`;
      segment=[];
    }
  }
  // Every hour is explicitly marked, including hours without available forecast data.
  for(let h=0;h<24;h++){
    const x=left+h*(right-left)/23;
    s+=`<line x1="${x}" x2="${x}" y1="${plotBottom+2}" y2="${plotBottom+9}" stroke="#84b6c7"/>`;
    s+=`<text x="${x}" y="${plotBottom+18}" transform="rotate(65 ${x} ${plotBottom+18})" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="#cce4ed">${String(h).padStart(2,'0')}</text>`;
  }
  if(!valid.length)s+=txt(355,y+94,'Data unavailable',28,'#d5e6eb');
  return s;
}
function card(type,name,day,rows){const wind=avg(rows,'avgWindKn'),gust=max(rows,'peakGustKn'),sea=avg(rows,'avgWaveM'),period=avg(rows,'avgWavePeriodS'),current=avg(rows,'avgCurrentKn'),rain=max(rows,'rainProbabilityPct'),rainfall=sum(rows,'precipSumMm'),uv=max(rows,'uvHourlyMax'),windDir=compass(avg(rows,'windDirMeanDeg')),currentDir=compass(avg(rows,'currentDirMeanDeg')),score=windowScore(rows),status=score===null?'DATA LIMITED':score>=75?'FAVOURABLE':score>=55?'CAUTION':'UNFAVOURABLE';let body='';
if(type==='snapshot'){
body+=panel(300,310)+rect(70,335,940,125,score===null?'#626e7a':score>=75?'#087d59':score>=55?'#bd8a08':'#a53734',22)+txt(100,415,status,53,'#fff',800)+txt(780,415,score===null?'—':score+'/100',47,'#fff',800);
body+=metric(65,495,'AVERAGE WIND',fmt(wind)+' kn')+metric(393,495,'PEAK GUST',fmt(gust)+' kn')+metric(721,495,'AVERAGE SEAS',fmt(sea)+' m');body+=metric(65,665,'CURRENT',fmt(current)+' kn')+metric(393,665,'WAVE PERIOD',fmt(period)+' s')+metric(721,665,'MAX RAIN CHANCE',rain===null?'—':Math.round(rain)+'%');body+=panel(860,300)+txt(72,913,'WIND '+windDir+' · CURRENT '+currentDir+' · RAIN '+(rainfall===null?'—':fmt(rainfall)+' mm')+' · UV '+(uv===null?'—':fmt(uv,0)),25,'#a9dced',600)+txt(72,974,'WHAT THIS MEANS',34,'#72d8f0',700)+txt(72,1035,score===null?'Insufficient measurements for an overall score.':score>=75?'Relatively settled conditions in this forecast window.':score>=55?'Some conditions warrant additional caution.':'Conditions may be challenging for small craft.',29,'#fff',500)+txt(72,1111,'Scores are experimental; vessel and route not assessed.',23,'#bed5dd',400);
}else if(type==='trends'){
const chartRows=dayRows24(rows);const available=chartRows.filter(r=>r.available).length;body+=panel(290,905)+txt(70,328,'00:00–23:00 · EACH TICK = 1 HOUR',24,'#b7dbe8',600)+lineChart(chartRows,'avgWindKn',372,'#32bbff',15)+lineChart(chartRows,'avgWaveM',658,'#68e2c1',1.5)+lineChart(chartRows,'rainProbabilityPct',944,'#f7c55d',100)+txt(75,1223,available+'/24 hourly records available · Gaps mean unavailable data',21,'#e2c988',500);
}else if(type==='windows'){
const win=windows(rows),best=win[0],other=win.find(w=>best&&w.start!==best.start&&Math.abs(Number(w.start.slice(0,2))-Number(best.start.slice(0,2)))>=2);body+=panel(300,440)+txt(75,365,'BEST TWO-HOUR WINDOW',32,'#80e6ec',700);body+=txt(75,450,best?best.start+' – '+best.end:'Unavailable',64,'#fff',800);body+=txt(75,530,best?'Conditions score '+best.score+'/100':'Insufficient hourly data',32,'#e6eff4');body+=txt(75,615,best&&best.score>=75?'Relatively lighter forecast wind and seas.':best?'Compare wind, seas and gusts before departure.':'No recommendation available.',29,'#d2e8ed');body+=panel(770,315)+txt(75,835,'ALTERNATIVE WINDOW',30,'#80e6ec',700)+txt(75,910,other?other.start+' – '+other.end:'No separate window identified',44,'#fff',750)+txt(75,1005,'Weather suitability only; not a fish-bite prediction.',25,'#c7dce4');body+=txt(75,1150,'Never use this score alone to decide whether to go to sea.',24,'#f6d67a');
}else if(type==='intelligence'){
body+=panel(300,775)+txt(75,370,'BANK CONDITIONS',35,'#80e6ec',700)+metric(70,420,'SURFACE CURRENT',fmt(current)+' kn')+metric(395,420,'SEAS',fmt(sea)+' m')+metric(720,420,'WAVE PERIOD',fmt(period)+' s');body+=txt(75,655,'WIND '+windDir+' · CURRENT '+currentDir+' · UV '+(uv===null?'—':fmt(uv,0)),26,'#d0e8ef',600)+txt(75,725,'FISHING CONTEXT',34,'#80e6ec',700)+txt(75,790,'Compare drift, sea state and wind exposure.',29,'#fff',500)+txt(75,860,'Species activity and water clarity are not inferred.',26,'#d2e5eb')+txt(75,950,'Use the live Fishing Intelligence map for more detail.',25,'#d2e5eb');body+=txt(75,1150,'This graphic does not predict catches or safe passage.',24,'#f6d67a');
}return base(name,day,({snapshot:'Conditions Snapshot',trends:'Hourly Forecast Trends',windows:'Fishing Windows',intelligence:'Bank Intelligence'})[type],body);}
// Reuse the condition-themed photography already approved for the production Instagram renders.
const backgrounds={GREEN:'instagram/background-good.jpg',YELLOW:'instagram/background-fair.jpg',RED:'instagram/background-poor.jpg'};
const backgroundBuffer={};for(const [status,path] of Object.entries(backgrounds))backgroundBuffer[status]=await readFile(path);
let done=0;const manifest=[];
for(const [key,name] of banks){const data=JSON.parse(await readFile(`banks/hourly/${key}-current.json`,'utf8'));const rows=data.hours||[];if(!rows.length)throw Error('Missing hourly rows for '+key);for(const type of ['snapshot','trends','windows','intelligence']){const svg=card(type,name,data.day,rows);const path=`${out}/${key}-${type}.png`;const statuses=rows.map(r=>String(r.conditionColor||'').toUpperCase());
const status=statuses.includes('RED')?'RED':statuses.includes('YELLOW')?'YELLOW':statuses.includes('GREEN')?'GREEN':null;
// Never assign a favourable background when the source has no valid condition status.
const background=status?await sharp(backgroundBuffer[status]).resize(W,H,{fit:'cover'}).modulate({brightness:.57}).png().toBuffer():null;
const artwork=sharp(Buffer.from(svg));
// SVG panels stay readable; background photography is composited under a translucent SVG layer.
if(background){
 const overlay=svg.replace(/<rect x="0" y="0" width="1080" height="1350" rx="0" fill="url\(#bg\)" stroke="none"\/>/, '<rect x="0" y="0" width="1080" height="1350" fill="#061e32" fill-opacity="0.62"/>');
 await sharp(background).composite([{input:Buffer.from(overlay)}]).png().toFile(path);
}else await artwork.png().toFile(path);
manifest.push({key,name,type,path,day:data.day,version:data.version,published_at:data.published_at,source_hours:rows.length,condition_background:status||'neutral',data_fields:'actual published hourly JSON; unavailable values shown as dashes'});console.log('Generated',path);done++;}}
await writeFile(`${out}/manifest.json`,JSON.stringify({generated_at:new Date().toISOString(),components:manifest},null,2));console.log('Generated '+done+' pilot graphics');
