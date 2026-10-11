import { readdirSync, readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './paths.mjs';
function walk(path){return readdirSync(path,{withFileTypes:true}).flatMap(x=>['node_modules','.git','reports'].includes(x.name)?[]:x.isDirectory()?walk(join(path,x.name)):[join(path,x.name)]);}
let count=0,failures=0;
for(const file of walk(root)){
    if(file.endsWith('.mjs')){const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(check.status!==0){console.error(check.stderr);failures++;}count++;}
    else if(file.endsWith('.json')){try{JSON.parse(readFileSync(file,'utf8'));}catch(e){console.error(file,e.message);failures++;}}
    else if(file.endsWith('.sh')){const check=spawnSync('bash',['-n',file],{encoding:'utf8'});if(check.status!==0){console.error(check.stderr);failures++;}}
}
console.log(`Checked ${count} JavaScript modules, JSON and shell syntax; failures=${failures}`);process.exitCode=failures?1:0;
