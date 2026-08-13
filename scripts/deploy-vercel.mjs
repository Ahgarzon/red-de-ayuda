import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const TOKEN=process.env.VERCEL_TOKEN; const ROOT='/tmp/red-de-ayuda';
const H={'Authorization':'Bearer '+TOKEN,'User-Agent':'Mozilla/5.0'};
function walk(d){let out=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='.git')continue;const p=path.join(d,e.name);if(e.isDirectory())out=out.concat(walk(p));else out.push(p);}return out;}
const files=walk(ROOT);
const manifest=[];
for(const abs of files){
  const buf=fs.readFileSync(abs);
  const sha=crypto.createHash('sha1').update(buf).digest('hex');
  const rel=path.relative(ROOT,abs);
  // upload
  const up=await fetch('https://api.vercel.com/v2/files',{method:'POST',headers:{...H,'Content-Type':'application/octet-stream','x-vercel-digest':sha},body:buf});
  if(!up.ok){console.error('upload fail',rel,up.status,await up.text());process.exit(1);}
  manifest.push({file:rel,sha,size:buf.length});
  console.log('uploaded',rel,buf.length);
}
const body={name:'red-de-ayuda',files:manifest,projectSettings:{framework:null},target:'production'};
const dep=await fetch('https://api.vercel.com/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify(body)});
const j=await dep.json();
if(!dep.ok){console.error('deploy fail',dep.status,JSON.stringify(j).slice(0,800));process.exit(1);}
console.log('DEPLOY id',j.id,'url',j.url,'state',j.readyState||j.status);
