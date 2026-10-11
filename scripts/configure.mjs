import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, copyFileSync, constants, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root, stateRoot, paseoHome, mixdogHome, journalRoot, worker } from './paths.mjs';
export function configure({home=paseoHome, enginePath=worker, nativeHome=mixdogHome, stateDir=journalRoot, trustPlugins=false}={}) {
    if(!trustPlugins) throw new Error('Explicit --trust-plugins required. Plugin and agent code run with this user\'s filesystem/network access.');
    for(const path of [home,nativeHome,stateDir]) {mkdirSync(path,{recursive:true,mode:0o700});if(lstatSync(path).isSymbolicLink()) throw new Error('Refusing symlink config directory');}
    const file=join(home,'config.json');
    if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw new Error('Refusing symlink config');
    const previous=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1};
    const providers={...(previous.agents?.providers||{})};
    providers.paseodog={...(providers.paseodog||{}),enabled:true,command:[process.execPath,enginePath],env:{...(providers.paseodog?.env||{}),MIXDOG_HOME:nativeHome,PASEODOG_STATE_DIR:stateDir}};
    // Never add plugin source entries by hand: Paseo owns their install lifecycle.
    const config={...previous,version:1,pluginsEnabled:true,
        daemon:previous.daemon||{listen:'127.0.0.1:6767',hostnames:['localhost','127.0.0.1'],relay:{enabled:false}},
        agents:{...(previous.agents||{}),providers}};
    if(existsSync(file))copyFileSync(file,`${file}.backup-${Date.now()}-${randomUUID().slice(0,8)}`,constants.COPYFILE_EXCL);
    const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);
    return file;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{console.log(configure({trustPlugins:process.argv.includes('--trust-plugins')}));}
    catch(e){console.error(e.message);process.exitCode=1;}
}
