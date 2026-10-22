import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { root, stateRoot, launcherPath } from './paths.mjs';
if(!['linux','win32'].includes(process.platform)){console.error('Linux systemd user service or Windows logon start only');process.exit(1);}
if(!process.argv.includes('--install')){console.log('Run: node scripts/service.mjs --install (registers startup only; does not start it)');process.exit(0);}
if(process.platform==='win32'){
    // Per-user Run key: starts the dedicated daemon at logon without administrator rights.
    const key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const result=spawnSync('reg.exe',['add',key,'/v','PaseoDog','/t','REG_SZ','/d',`"${launcherPath}" start`,'/f'],{encoding:'utf8',windowsHide:true});
    if(result.status!==0){console.error(result.error?.message||result.stderr||'reg add failed');process.exit(1);}
    console.log(`Registered ${key}\\PaseoDog -> "${launcherPath}" start\nRemove with: reg delete ${key} /v PaseoDog /f\nNo daemon was started automatically.`);
    process.exit(0);
}
const quote=(s)=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
const dir=join(homedir(),'.config','systemd','user');mkdirSync(dir,{recursive:true});
const file=join(dir,'paseodog.service');
writeFileSync(file,`[Unit]\nDescription=PaseoDog Linux coding host\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${quote(root)}\nEnvironment=${quote('PASEODOG_HOME='+stateRoot)}\nExecStart=${quote(process.execPath)} ${quote(join(root,'bin/paseodog.mjs'))} serve\nRestart=on-failure\nRestartSec=5\nKillMode=control-group\nTimeoutStopSec=30\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`,{mode:0o600});
console.log(`Wrote ${file}\nStop the managed daemon before starting this foreground service:\n  paseodog daemon stop\n  systemctl --user daemon-reload\n  systemctl --user enable --now paseodog.service\nTo keep the service after logout, an administrator must enable lingering for this user.\nNo service was started automatically.`);
