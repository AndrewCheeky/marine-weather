import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const banks=[['maiden','Maiden Cay'],['bowditch','Mackerel (Bowditch) Bank'],['california','California Bank']];
const out='pilot/generated';await mkdir(out,{recursive:true});
const W=1080,H=1350;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fmt=(v,d=1)=>n(v)===null?'—':n(v).toFixed(d);
const avg=(rows,k)=>{const v=rows.filter(r=>r.available!==false).map(r=>n(r[k])).filter(v=>v!==null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
const sum=(rows,k)=>{const v=rows.filter(r=>r.available!==false).map(r=>n(r[k])).filter(v=>v!==null);return v.length?v.reduce((a,b)=>a+b,0):null};
const max=(rows,k)=>{const v=rows.filter(r=>r.available!==false).map(r=>n(r[k])).filter(v=>v!==null);return v.length?Math.max(...v):null};
const txt=(x,y,t,size=36,color='#fff',weight=600,extra='')=>`<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${esc(t)}</text>`;
const rect=(x,y,w,h,fill,rx=24,stroke='none')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;
const base=(name,day,title,inner)=>{const hh=title==='Hourly Forecast Trends'?1650:H;return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${hh}" viewBox="0 0 ${W} ${hh}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#06253b"/><stop offset="1" stop-color="#0a4762"/></linearGradient><linearGradient id="sea" x2="1" y2="1"><stop stop-color="#127aa2"/><stop offset="1" stop-color="#06253b"/></linearGradient></defs>${rect(0,0,W,hh,'url(#bg)',0)}${rect(0,0,W,16,'#17b4da',0)}${txt(54,80,'JAMAICA MARINE WEATHER',34,'#74e1f7',800)}${txt(54,148,title,54,'#fff',800)}${txt(54,206,name,33,'#cceaf3',600)}${txt(54,252,day+'  ·  JAMAICA TIME',25,'#9ec4d3',500)}${inner}${rect(35,hh-100,1010,2,'#32728b',0)}${txt(54,hh-55,'marine-weather.andrewcheeky.com',24,'#a9d7e7',600)}${txt(54,hh-26,'Forecast guidance only · Not for navigation · Check official advisories',19,'#b6c9d1',400)}</svg>`;};
const compass=deg=>{const d=n(deg);return d===null?'—':['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((d%360)+360)%360/22.5)%16]};
const panel=(y,h)=>rect(40,y,1000,h,'#0b354c',26,'#266b86');
const metric=(x,y,label,value)=>rect(x,y,292,145,'#10445d',20)+txt(x+22,y+45,label,24,'#8ddbf1',600)+txt(x+22,y+111,value,42,'#fff',800);
function windowScore(rows){if(!rows.length)return null;const w=avg(rows,'avgWindKn'),g=max(rows,'peakGustKn'),s=max(rows,'avgWaveM'),p=avg(rows,'avgWavePeriodS');if([w,g,s].some(v=>v===null))return null;let score=100-Math.max(0,w-5)*3-Math.max(0,g-10)*2-Math.max(0,s-.6)*28-(p!==null&&p<5?10:0);const rain=max(rows,'rainProbabilityPct');if(rain!==null)score-=rain*.12;return Math.max(0,Math.min(100,Math.round(score)));}
function windows(hours){const pairs=[];for(let i=0;i<hours.length-1;i++){const r=hours.slice(i,i+2);if(r.some(x=>x.available===false))continue;const score=windowScore(r);if(score!==null)pairs.push({start:r[0].time,end:r[1].time,score,rows:r});}return pairs.sort((a,b)=>b.score-a.score);}
// A fixed 24-hour Jamaica-time axis. Missing source hours remain gaps, never estimates.
function dayRows24(rows){
  // Fetcher supplies a 04:00–03:00 Jamaica-time sequence, including explicit gaps.
  return rows.slice(0,24).map((r,i)=>({...r,time:String((4+i)%24).padStart(2,'0')+':00',available:r.available!==false}));
}

const colX=i=>118+i*37.2;
function trendPanel(rows,y,title,series,maxScale,units){
  const plotTop=y+70,plotBottom=y+225,plotH=plotBottom-plotTop;
  let s=rect(55,y,970,330,'#082d46',18,'#287c9d')+txt(76,y+43,title,29,'#f0f9ff',800);
  series.forEach((v,j)=>{s+=`<circle cx="${530+j*190}" cy="${y+34}" r="6" fill="${v.color}"/>`+txt(545+j*190,y+41,v.label,19,'#fff',600)});
  for(let t=0;t<=4;t++){let yy=plotBottom-t*plotH/4;s+=`<line x1="112" y1="${yy}" x2="986" y2="${yy}" stroke="#24546b" stroke-width="1"/>`+txt(67,yy+5,String(Math.round(maxScale*t/4)),17,'#b8d8e5',400)}
  for(const spec of series){
    let path='',last=false;
    rows.forEach((r,i)=>{const v=r.available===false?null:n(r[spec.key]);if(v===null){last=false;return;}
      const x=colX(i),yy=plotBottom-Math.min(maxScale,Math.max(0,v))/maxScale*plotH;
      path+=(last?' L ':' M ')+x.toFixed(1)+' '+yy.toFixed(1);last=true;
      s+=`<circle cx="${x}" cy="${yy}" r="3.1" fill="${spec.color}"/>`;
    });
    s+=`<path d="${path}" fill="none" stroke="${spec.color}" stroke-width="3.5" stroke-linejoin="round"/>`;
  }
  for(let i=0;i<24;i++){const x=colX(i);s+=`<text x="${x}" y="${y+257}" font-family="Arial" font-size="14" text-anchor="middle" fill="#d5ebf4">${String((i+4)%24).padStart(2,'0')}</text>`;}
  s+=txt(76,y+304,units,19,'#a8d8e8',500);
  return s;
}
function directionRow(rows,y,key,label,from=true,period=false){
  let s=txt(62,y+17,label,20,'#bcebf7',650);
  for(let i=0;i<24;i++){
    const x=colX(i),d=rows[i]?.available===false?null:n(rows[i]?.[key]);
    if(d===null){s+=`<text x="${x}" y="${y+45}" font-size="18" text-anchor="middle" fill="#809da8">–</text>`;continue;}
    // Compass degrees represent direction FROM for wind, TOWARD for swell when explicitly available.
    const angle=(d+(from?180:0))%360;
    s+=`<g transform="translate(${x} ${y+35}) rotate(${angle})"><path d="M0 -11 L6 6 L0 3 L-6 6 Z" fill="#6ae5fa"/></g>`;
  }
  if(period){
    s+=txt(62,y+83,'Period (s)',20,'#bcebf7',650);
    rows.forEach((r,i)=>{s+=`<text x="${colX(i)}" y="${y+83}" font-size="17" font-family="Arial" text-anchor="middle" fill="#fff">${fmt(r.available===false?null:r.avgWavePeriodS,0)}</text>`;});
  }
  return s;
}
function skySymbol(r,h){
  if(r.available===false)return '·';
  const code=n(r.weatherCode);
  if(code!==null){
    if([95,96,99].includes(code))return '⚡';
    if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return '☂';
    if([71,73,75,77,85,86].includes(code))return '❄';
    if([2,3,45,48].includes(code))return '☁';
    if(code===1)return '⛅';
    if(code===0)return h>=6&&h<18?'☀':'☾';
  }
  return h>=6&&h<18?'·':'☾';
}
function weatherPanel(rows,y){
  let s=rect(55,y,970,348,'#082d46',18,'#287c9d')+txt(76,y+42,'WEATHER',29,'#fff',800);
  const series=[{key:'temperatureC',color:'#ff777c',label:'Temp °C'},{key:'uvHourlyMax',color:'#f9b93b',label:'UV'},{key:'rainProbabilityPct',color:'#76e38c',label:'Rain %'}];
  series.forEach((v,j)=>s+=`<circle cx="${600+j*130}" cy="${y+35}" r="5" fill="${v.color}"/>`+txt(612+j*130,y+41,v.label,17,'#fff',500));
  rows.forEach((r,i)=>{const h=(i+4)%24,x=colX(i);s+=`<text x="${x}" y="${y+85}" font-family="Arial" font-size="23" text-anchor="middle" fill="#fff">${esc(skySymbol(r,h))}</text>`;});
  const top=y+112,bottom=y+256;
  for(let j=0;j<=3;j++){const yy=bottom-j*(bottom-top)/3;s+=`<line x1="112" y1="${yy}" x2="986" y2="${yy}" stroke="#24546b"/>`;}
  for(const sp of series){
    let path='',prev=false;
    rows.forEach((r,i)=>{const v=r.available===false?null:n(r[sp.key]);if(v===null){prev=false;return;}
      const scale=sp.key==='temperatureC'?45:sp.key==='uvHourlyMax'?15:100;
      const yy=bottom-Math.min(scale,Math.max(0,v))/scale*(bottom-top),x=colX(i);
      path+=(prev?' L ':' M ')+x.toFixed(1)+' '+yy.toFixed(1);prev=true;
      s+=`<circle cx="${x}" cy="${yy}" r="2.8" fill="${sp.color}"/>`;
    });
    s+=`<path d="${path}" fill="none" stroke="${sp.color}" stroke-width="3"/>`;
  }
  rows.forEach((r,i)=>{s+=`<text x="${colX(i)}" y="${y+282}" font-family="Arial" font-size="14" text-anchor="middle" fill="#d5ebf4">${String((i+4)%24).padStart(2,'0')}</text>`;});
  s+=txt(76,y+320,'Separate scales: temperature 0–45°C · UV 0–15 · rain 0–100%',17,'#a8d8e8',500);
  return s;
}

// Three integrated chart panels, with direction, period and weather icons INSIDE each panel.
// All 25 tick labels include the closing 04:00 on the next day; data is plotted only when supplied.
function integratedTrends(rows,available){
 const x=i=>126+i*35.9, left=126,right=x(24);
 const num=(r,k)=>r&&r.available!==false?n(r[k]):null;
 const hours=Array.from({length:25},(_,i)=>String((i+4)%24).padStart(2,'0'));
 function axis(y){let t='';hours.forEach((h,i)=>t+=`<text x="${x(i)}" y="${y}" text-anchor="middle" font-family="Arial" font-size="13" fill="#d3e9f4">${h}</text>`);return t;}
 function lines(rows,series,top,bottom){
  let t='';for(let j=0;j<=4;j++){const yy=bottom-(bottom-top)*j/4;t+=`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#28556c" stroke-width="1"/>`;}
  for(const z of series){let path='',connected=false;rows.forEach((r,i)=>{let v=num(r,z.key);if(v===null){connected=false;return;}const yy=bottom-Math.max(0,Math.min(1,v/z.max))*(bottom-top);path+=(connected?' L ':' M ')+x(i).toFixed(1)+' '+yy.toFixed(1);connected=true;t+=`<circle cx="${x(i)}" cy="${yy}" r="2.8" fill="${z.color}"/>`;});t+=`<path d="${path}" fill="none" stroke="${z.color}" stroke-width="3.2"/>`;}
  return t;
 }
 function legend(series,y){return series.map((z,j)=>`<circle cx="${480+j*170}" cy="${y}" r="5" fill="${z.color}"/>`+txt(494+j*170,y+6,z.label,17,'#e6f5ff',600)).join('');}
 function arrows(key,y,wind){let t='';rows.forEach((r,i)=>{let v=num(r,key);if(v===null){t+=`<text x="${x(i)}" y="${y+6}" text-anchor="middle" fill="#7795a5" font-size="17">·</text>`;return;}const angle=(v+(wind?180:0))%360;t+=`<g transform="translate(${x(i)} ${y}) rotate(${angle})"><path d="M0 -11 L6 7 L0 3 L-6 7 Z" fill="#6ce7f7"/></g>`;});return t;}
 function boxAt(y,h,title){return rect(44,y,992,h,'#082d46',20,'#287c9d')+txt(67,y+43,title,29,'#f1faff',800);}
 const wind=[{key:'avgWindKn',label:'Wind',color:'#20c6f2',max:Math.max(20,Math.ceil((max(rows,'peakGustKn')||0)/5)*5)},{key:'peakGustKn',label:'Gusts',color:'#ffaf3c',max:Math.max(20,Math.ceil((max(rows,'peakGustKn')||0)/5)*5)}];
 const seasMax=Math.max(2,Math.ceil(Math.max(max(rows,'avgWaveM')||0,max(rows,'peakWaveM')||0)*2)/2);
 const seas=[{key:'avgWaveM',label:'Waves',color:'#20c6f2',max:seasMax},{key:'peakWaveM',label:'Peak waves',color:'#ffaf3c',max:seasMax}];
 let t=boxAt(278,360,'WIND & GUSTS')+legend(wind,313)+lines(rows,wind,350,480)+axis(504)+txt(67,547,'Wind direction (toward)',19,'#bcebf7',600)+arrows('windDirMeanDeg',565,true)+txt(67,609,'Wind and gust speed in knots · direction arrows show travel',17,'#a8d8e8',400);
 t+=boxAt(650,408,'SEAS & SWELL')+legend(seas,685)+lines(rows,seas,722,842)+axis(865)+txt(67,902,'Swell direction (toward)',19,'#bcebf7',600)+arrows('swellDirDeg',922,false)+txt(67,972,'Period (s)',19,'#bcebf7',600);
 rows.forEach((r,i)=>t+=`<text x="${x(i)}" y="${972}" text-anchor="middle" fill="#fff" font-size="16">${num(r,'avgWavePeriodS')===null?'·':Math.round(num(r,'avgWavePeriodS'))}</text>`);
 t+=txt(67,1032,'Wave height in metres · peak waves only where provided',17,'#a8d8e8',400);
 const weather=[{key:'temperatureC',label:'Temp °C',color:'#ff737e',max:45},{key:'uvHourlyMax',label:'UV',color:'#ffc043',max:15}];
 t+=boxAt(1070,424,'WEATHER')+legend(weather,1105);
 rows.forEach((r,i)=>{const symbol=num(r,'weatherCode')===null?'·':skySymbol(r,(i+4)%24);t+=`<text x="${x(i)}" y="1153" font-size="22" text-anchor="middle" fill="#fff">${esc(symbol)}</text>`;});
 t+=lines(rows,weather,1175,1290)+axis(1314);
 t+=txt(67,1351,'Rain chance (%)',18,'#9be9a7',600);
 rows.forEach((r,i)=>{const v=num(r,'rainProbabilityPct');t+=`<text x="${x(i)}" y="1375" text-anchor="middle" font-family="Arial" font-size="14" fill="${v===null?'#7795a5':'#9be9a7'}">${v===null?'·':Math.round(v)+'%'}</text>`;});
 t+=txt(67,1409,'Temperature 0–45°C · UV 0–15 · rain probability shown hourly as %',17,'#a8d8e8',400);
 t+=txt(67,1445,available+'/24 hourly forecast records available · Missing values shown as gaps',20,'#f1d08c',500);
 t+=txt(67,1477,'04:00 next day closes the timeline; no unsupplied values are plotted',17,'#b7d7e4',400);
 return t;
}
function card(type,name,day,rows){const wind=avg(rows,'avgWindKn'),gust=max(rows,'peakGustKn'),sea=avg(rows,'avgWaveM'),period=avg(rows,'avgWavePeriodS'),current=avg(rows,'avgCurrentKn'),rain=max(rows,'rainProbabilityPct'),rainfall=sum(rows,'precipSumMm'),uv=max(rows,'uvHourlyMax'),windDir=compass(avg(rows,'windDirMeanDeg')),currentDir=compass(avg(rows,'currentDirMeanDeg')),score=windowScore(rows),status=score===null?'DATA LIMITED':score>=75?'FAVOURABLE':score>=55?'CAUTION':'UNFAVOURABLE';let body='';
if(type==='snapshot'){
body+=panel(300,310)+rect(70,335,940,125,score===null?'#626e7a':score>=75?'#087d59':score>=55?'#bd8a08':'#a53734',22)+txt(100,415,status,53,'#fff',800)+txt(780,415,score===null?'—':score+'/100',47,'#fff',800);
body+=metric(65,495,'AVERAGE WIND',fmt(wind)+' kn')+metric(393,495,'PEAK GUST',fmt(gust)+' kn')+metric(721,495,'AVERAGE SEAS',fmt(sea)+' m');body+=metric(65,665,'CURRENT',fmt(current)+' kn')+metric(393,665,'WAVE PERIOD',fmt(period)+' s')+metric(721,665,'MAX RAIN CHANCE',rain===null?'—':Math.round(rain)+'%');body+=panel(860,300)+txt(72,913,'WIND '+windDir+' · CURRENT '+currentDir+' · RAIN '+(rainfall===null?'—':fmt(rainfall)+' mm')+' · UV '+(uv===null?'—':fmt(uv,0)),25,'#a9dced',600)+txt(72,974,'WHAT THIS MEANS',34,'#72d8f0',700)+txt(72,1035,score===null?'Insufficient measurements for an overall score.':score>=75?'Relatively settled conditions in this forecast window.':score>=55?'Some conditions warrant additional caution.':'Conditions may be challenging for small craft.',29,'#fff',500)+txt(72,1111,'Scores are experimental; vessel and route not assessed.',23,'#bed5dd',400);
 }else if(type==='trends'){
const chartRows=dayRows24(rows),available=chartRows.filter(r=>r.available!==false).length;
body+=integratedTrends(chartRows,available);
}else if(type==='windows'){
const win=windows(rows),best=win[0],other=win.find(w=>best&&w.start!==best.start&&Math.abs(Number(w.start.slice(0,2))-Number(best.start.slice(0,2)))>=2);body+=panel(300,440)+txt(75,365,'BEST TWO-HOUR WINDOW',32,'#80e6ec',700);body+=txt(75,450,best?best.start+' – '+best.end:'Unavailable',64,'#fff',800);body+=txt(75,530,best?'Conditions score '+best.score+'/100':'Insufficient hourly data',32,'#e6eff4');body+=txt(75,615,best&&best.score>=75?'Relatively lighter forecast wind and seas.':best?'Compare wind, seas and gusts before departure.':'No recommendation available.',29,'#d2e8ed');body+=panel(770,315)+txt(75,835,'ALTERNATIVE WINDOW',30,'#80e6ec',700)+txt(75,910,other?other.start+' – '+other.end:'No separate window identified',44,'#fff',750)+txt(75,1005,'Weather suitability only; not a fish-bite prediction.',25,'#c7dce4');body+=txt(75,1150,'Never use this score alone to decide whether to go to sea.',24,'#f6d67a');
}else if(type==='intelligence'){
body+=panel(300,775)+txt(75,370,'BANK CONDITIONS',35,'#80e6ec',700)+metric(70,420,'SURFACE CURRENT',fmt(current)+' kn')+metric(395,420,'SEAS',fmt(sea)+' m')+metric(720,420,'WAVE PERIOD',fmt(period)+' s');body+=txt(75,655,'WIND '+windDir+' · CURRENT '+currentDir+' · UV '+(uv===null?'—':fmt(uv,0)),26,'#d0e8ef',600)+txt(75,725,'FISHING CONTEXT',34,'#80e6ec',700)+txt(75,790,'Compare drift, sea state and wind exposure.',29,'#fff',500)+txt(75,860,'Species activity and water clarity are not inferred.',26,'#d2e5eb')+txt(75,950,'Use the live Fishing Intelligence map for more detail.',25,'#d2e5eb');body+=txt(75,1150,'This graphic does not predict catches or safe passage.',24,'#f6d67a');
}return base(name,day,({snapshot:'Conditions Snapshot',trends:'Hourly Forecast Trends',windows:'Fishing Windows',intelligence:'Bank Intelligence'})[type],body);}
// Reuse the condition-themed photography already approved for the production Instagram renders.
const backgrounds={GREEN:'instagram/background-good.jpg',YELLOW:'instagram/background-fair.jpg',RED:'instagram/background-poor.jpg'};
const backgroundBuffer={};for(const [status,path] of Object.entries(backgrounds))backgroundBuffer[status]=await readFile(path);
let done=0;const manifest=[];
for(const [key,name] of banks){const data=JSON.parse(await readFile(`pilot/cache/${key}-24h.json`,'utf8'));const rows=data.hours||[];if(!rows.some(r=>r.available!==false))throw Error('Missing hourly rows for '+key);for(const type of ['snapshot','trends','windows','intelligence']){const svg=card(type,name,data.day,rows);const path=`${out}/${key}-${type}.png`;const statuses=rows.filter(r=>r.available!==false).map(r=>String(r.conditionColor||'').toUpperCase());
const status=statuses.includes('RED')?'RED':statuses.includes('YELLOW')?'YELLOW':statuses.includes('GREEN')?'GREEN':null;
// Never assign a favourable background when the source has no valid condition status.
const height=type==='trends'?1650:H;const background=status?await sharp(backgroundBuffer[status]).resize(W,height,{fit:'cover'}).modulate({brightness:.57}).png().toBuffer():null;
const artwork=sharp(Buffer.from(svg));
// SVG panels stay readable; background photography is composited under a translucent SVG layer.
if(background){
 const overlay=svg.replace(/<rect x="0" y="0" width="1080" height="[0-9]+" rx="0" fill="url\(#bg\)" stroke="none"\/>/, `<rect x="0" y="0" width="1080" height="${height}" fill="#061e32" fill-opacity="0.62"/>`);
 await sharp(background).composite([{input:Buffer.from(overlay)}]).png().toFile(path);
}else await artwork.png().toFile(path);
manifest.push({key,name,type,path,day:data.day,version:data.version,published_at:data.published_at,source_hours:rows.length,condition_background:status||'neutral',data_fields:'actual published hourly JSON; unavailable values shown as dashes'});console.log('Generated',path);done++;}}
await writeFile(`${out}/manifest.json`,JSON.stringify({generated_at:new Date().toISOString(),components:manifest},null,2));console.log('Generated '+done+' pilot graphics');
