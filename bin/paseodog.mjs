#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { root, paseoHome, paseoBin, nativeBin, runtimeEnv } from '../scripts/paths.mjs';
import { join } from 'node:path';
const args=process.argv.slice(2),command=args.shift();
const help=`PaseoDog 1.0.0-rc.1 - Linux Mixdog engine, Paseo UI/CLI\n
paseodog start                 Start the dedicated Paseo daemon
paseodog serve                 Foreground daemon (systemd entrypoint)
paseodog auth                  Open Mixdog TUI in the dedicated auth profile
paseodog doctor                Check local installation without inference
paseodog live-test --confirm-api-use   Real engine smoke test (billable)
paseodog run "task"            New PaseoDog agent (requires approvals)
paseodog ls                    List agents
paseodog attach <agent-id>      Follow output from SSH
paseodog send <agent-id> "task" Continue the same agent
paseodog stop <agent-id>        Interrupt an agent (does not undo changes)
paseodog password              Configure daemon password interactively
paseodog <paseo arguments>     Pass through to pinned Paseo CLI

State: ${paseoHome}
Mobile uses the existing Paseo app. No new Android APK is bundled.
`;
if(!command||['help','--help','-h'].includes(command)){console.log(help);process.exit(0);}
let executable,argv;
if(command==='doctor'){executable=process.execPath;argv=[join(root,'scripts/doctor.mjs'),...args];}
else if(command==='live-test'){executable=process.execPath;argv=[join(root,'scripts/live-smoke.mjs'),...args];}
else if(command==='auth'){executable=nativeBin;argv=args;}
else{
    executable=paseoBin;argv=['--home',paseoHome];
    if(command==='start')argv.push('daemon','start',...args);
    else if(command==='serve')argv.push('daemon','run',...args);
    else if(command==='password')argv.push('daemon','set-password',...args);
    else if(command==='run')argv.push('run',...(args.some(a=>a==='--provider'||a.startsWith('--provider='))?[]:['--provider','paseodog']),...args);
    else argv.push(command,...args);
}
if(!existsSync(executable)){console.error('Dependencies not installed. Run bash scripts/install.sh from the project folder.');process.exit(1);}
const child=spawn(executable,argv,{env:runtimeEnv(),stdio:'inherit',shell:false});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',(e)=>{console.error(e.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=typeof code==='number'?code:signal?130:1;});
