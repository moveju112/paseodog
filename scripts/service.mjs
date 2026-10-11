import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { root, stateRoot } from './paths.mjs';
if(process.platform!=='linux'){console.error('Linux systemd user service only');process.exit(1);}
if(!process.argv.includes('--install')){console.log('Run: node scripts/service.mjs --install (writes service only; does not start it)');process.exit(0);}
const quote=(s)=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
const dir=join(homedir(),'.config','systemd','user');mkdirSync(dir,{recursive:true});
const file=join(dir,'paseodog.service');
writeFileSync(file,`[Unit]\nDescription=PaseoDog Linux coding host\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${quote(root)}\nEnvironment=${quote('PASEODOG_HOME='+stateRoot)}\nExecStart=${quote(process.execPath)} ${quote(join(root,'bin/paseodog.mjs'))} serve\nRestart=on-failure\nRestartSec=5\nKillMode=control-group\nTimeoutStopSec=30\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`,{mode:0o600});
console.log(`Wrote ${file}\nStop the managed daemon before starting this foreground service:\n  paseodog daemon stop\n  systemctl --user daemon-reload\n  systemctl --user enable --now paseodog.service\nTo keep the service after logout, an administrator must enable lingering for this user.\nNo service was started automatically.`);
