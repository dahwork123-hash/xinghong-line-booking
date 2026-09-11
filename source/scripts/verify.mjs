import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const results=[];
const cases=fs.readdirSync('tests').filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f);
const steps=[
  ['syntax',['scripts/check.mjs']],
  ['unit-integration',['--test','--test-concurrency=1',...cases]],
  ['worker-build',['node_modules/wrangler/bin/wrangler.js','deploy','--env','staging','--dry-run','--outdir','.build']],
  ['cloudflare-local',['--test','tests-runtime/cloudflare.test.mjs']],
  ['browser',['scripts/browser-test.mjs']],
  ['dependency-audit',[process.env.npm_execpath,'audit','--json']],
];
fs.mkdirSync('test-results',{recursive:true});
for(const [name,args] of steps){
  if(args.some(x=>!x))throw Error('Run through pnpm verify so the pinned package manager is available.');
  const started=Date.now(),r=spawnSync(process.execPath,args,{cwd:process.cwd(),encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:180000,maxBuffer:8*1024*1024});
  const log=(r.stdout||'')+(r.stderr||'')+(r.error?'\n'+r.error.message:'');
  fs.writeFileSync(path.join('test-results',name+'.log'),log,'utf8');
  results.push({name,status:r.status===0?'passed':'failed',exitCode:r.status,elapsedMs:Date.now()-started,log:name+'.log'});
  console.log(name+': '+results.at(-1).status);
  if(r.status!==0){console.error(log);process.exitCode=1;break;}
}
const report={version:'0.1.0-rc.1',time:new Date().toISOString(),node:process.version,platform:process.platform,status:results.length===steps.length&&results.every(r=>r.status==='passed')?'passed':'failed',results,limitations:['No live LINE access or messages','No remote D1 or Cloudflare deployment','Not an independent security audit']};
fs.writeFileSync('test-results/verification.json',JSON.stringify(report,null,2),'utf8');
