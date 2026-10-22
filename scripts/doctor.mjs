import { existsSync,readFileSync,lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root,paseoHome,mixdogHome,journalRoot,paseoBin,nativeBin,supportedNode } from './paths.mjs';
import { patch, PIN } from './patch-mixdog.mjs';
import { CLI_VERSION } from './patch-paseo-cli.mjs';
import { windowsCompilerPath } from '../plugin/server/windows-job.mjs';
const checks=[];
const record=(name,ok,detail)=>checks.push({name,status:ok?'PASS':'FAIL',detail});
record('node',supportedNode(),process.versions.node+'; required ^22.19.0 || >=24.0.0');
record('git',spawnSync('git',['--version'],{encoding:'utf8'}).status===0,'Git executable');
if (process.platform === 'linux') {
    const scope = spawnSync('/usr/bin/systemctl', ['--user', 'show-environment'], {encoding:'utf8', timeout:3500});
    record('systemd user scope',scope.status===0,scope.status===0?'User cgroup manager available':'Per-session Linux shell containment unavailable; check XDG_RUNTIME_DIR and lingering');
}
if (process.platform === 'win32') {
    const compiler = windowsCompilerPath();
    record('Windows job helper compiler',existsSync(compiler),compiler+' (.NET Framework 4.x; builds the per-session kill-on-close job helper)');
}
for(const [name,file] of [['Paseo CLI',paseoBin],['Mixdog CLI',nativeBin]])record(name,existsSync(file),file);
for(const [name,path,pin] of [['Paseo','tools/node_modules/@getpaseo/cli/package.json',CLI_VERSION],['Mixdog','engine/node_modules/mixdog/package.json',PIN]]){
    try{const m=JSON.parse(readFileSync(join(root,path),'utf8'));record(name+' version',m.version===pin,m.version);}catch{record(name+' version',false,'Not installed');}
}
try{patch(join(root,'engine/node_modules/mixdog'),{check:true});record('host policy patch',true,'Verified original Git blob and injected callback');}catch(e){record('host policy patch',false,e.message);}
try{const c=JSON.parse(readFileSync(join(paseoHome,'config.json'),'utf8'));record('pluginsEnabled',c.pluginsEnabled===true,'Explicit trust required');record('provider command',Array.isArray(c.agents?.providers?.paseodog?.command),'Absolute Node + worker path');record('installed plugin',!!c.plugins?.['paseodog-provider'],'Paseo owns the source registration');
    const listen=c.daemon?.listen||'unset';record('listen configured',typeof listen==='string',listen);
}catch(e){record('Paseo config',false,e.message);}
for(const path of [paseoHome,mixdogHome,journalRoot]){
    // Windows has no POSIX mode bits; the per-user profile ACL protects %LOCALAPPDATA%.
    const exists=existsSync(path);record('private state directory',exists&&!lstatSync(path).isSymbolicLink()&&(process.platform==='win32'||(lstatSync(path).mode&0o077)===0),path);
}
const output={checkedAt:new Date().toISOString(),platform:process.platform,checks,
    notChecked:['Live account authentication','Real model response','Native helper execution','Android LTE/5G pairing','Server reboot/service recovery'],
    warning:'Passing doctor does not prove live production readiness; no inference request was made.'};
console.log(JSON.stringify(output,null,2));process.exitCode=checks.some(x=>x.status==='FAIL')?1:0;
