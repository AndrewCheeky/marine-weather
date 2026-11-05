// Assemble the public website into _site/ for GitHub Pages:
// the code from main + the latest generated files (restored from the data branch beforehand).
// Source-only files (scripts, workflows, docs, Apps Script) are left out, and every forecast
// poster PNG gets a much smaller WebP copy for the website to use.
import {cp,mkdir,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import sharp from 'sharp';

const OUT='_site';
const SKIP_DIRS=new Set(['.git','.github','scripts','node_modules',OUT,'banks/diagnostics']);
const SKIP_EXT=new Set(['.md','.gs','.mjs','.yml','.yaml','.sh','.diff','.txt']);

await rm(OUT,{recursive:true,force:true});
await mkdir(OUT,{recursive:true});

async function copyTree(dir){
  for(const entry of await readdir(dir||'.',{withFileTypes:true})){
    const rel=dir?join(dir,entry.name):entry.name;
    if(entry.isDirectory()){if(!SKIP_DIRS.has(rel)&&!entry.name.startsWith('.'))await copyTree(rel);continue;}
    if(SKIP_EXT.has(extname(entry.name).toLowerCase())||entry.name==='.gitignore')continue;
    await mkdir(join(OUT,dir||''),{recursive:true});
    await cp(rel,join(OUT,rel));
  }
}
await copyTree('');

// WebP copies of the posters (typically 80-90% smaller than the PNGs).
let converted=0,savedBytes=0;
for(const folder of ['instagram/generated']){
  let files=[];try{files=await readdir(join(OUT,folder));}catch{continue;}
  for(const name of files.filter(f=>f.endsWith('.png'))){
    const src=join(OUT,folder,name),dest=src.replace(/\.png$/,'.webp');
    try{
      await sharp(src).webp({quality:82}).toFile(dest);
      savedBytes+=(await stat(src)).size-(await stat(dest)).size;converted++;
    }catch(e){console.warn('WEBP SKIPPED',name,e.message);}
  }
}
// GitHub Pages serves this artifact as-is (no Jekyll processing).
await writeFile(join(OUT,'.nojekyll'),'');
console.log(`SITE BUILT: ${converted} posters converted to WebP, ${(savedBytes/1048576).toFixed(1)} MB smaller`);
