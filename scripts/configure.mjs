import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, copyFileSync, constants, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root, stateRoot, paseoHome, mixdogHome, journalRoot, worker, serverWebDist } from './paths.mjs';
const DISABLED_BUILTIN_PROVIDERS = ['claude', 'codex', 'copilot', 'opencode', 'pi', 'omp', 'muse', 'antigravity'];

// Mixdog 데이터 디렉터리에 기본 설정값(에이전트 전부 비활성, 지침 ON, 워크트리 OFF, 스킬 OFF)을 시드한다.
function seedMixdogData(nativeHome) {
    const dataDir = join(nativeHome, 'data');
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const cfgFile = join(dataDir, 'mixdog-config.json');
    let raw = {};
    if (existsSync(cfgFile)) {
        raw = JSON.parse(readFileSync(cfgFile, 'utf8'));
    }
    const agentSection = { ...(raw.agent || {}) };
    if (!agentSection.agents || typeof agentSection.agents !== 'object') agentSection.agents = {};
    if (!Array.isArray(agentSection.enabledAgents)) agentSection.enabledAgents = [];
    if (!agentSection.instructionFiles) agentSection.instructionFiles = 'all';
    if (!Object.hasOwn(agentSection, 'workflow')) agentSection.workflow = { active: 'none' };
    agentSection.worktree = {
        newTaskDefault: 'branch',
        branchPrefix: 'paseodog/',
        ...(agentSection.worktree || {}),
    };
    if (!agentSection.skills) agentSection.skills = { disabled: ['*'] };
    const nextRaw = {
        ...raw,
        defaultsVersion: raw.defaultsVersion || 2,
        agent: agentSection,
    };
    const tmp = cfgFile + '.' + randomUUID() + '.tmp';
    writeFileSync(tmp, JSON.stringify(nextRaw, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(tmp, cfgFile);
}

// PaseoDog 전용 공급자만 활성화하고 기본 내장·ACP 외부 공급자 및 타 공급자 프로필을 정리한다.
export function configure({home=paseoHome, enginePath=worker, nativeHome=mixdogHome, stateDir=journalRoot, trustPlugins=false,
    engineEnv={}, defaultListen='127.0.0.1:6767'}={}) {
    if(!trustPlugins) throw new Error('Explicit --trust-plugins required. Plugin and agent code run with this user\'s filesystem/network access.');
    for(const path of [home,nativeHome,stateDir]) {mkdirSync(path,{recursive:true,mode:0o700});if(lstatSync(path).isSymbolicLink()) throw new Error('Refusing symlink config directory');}
    seedMixdogData(nativeHome);
    const file=join(home,'config.json');
    if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw new Error('Refusing symlink config');
    const previous=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1};
    const providers={...(previous.agents?.providers||{})};
    for(const [id, entry] of Object.entries(providers)) {
        if(id!=='paseodog' && entry && typeof entry==='object' && entry.extends) delete providers[id];
    }
    for(const id of DISABLED_BUILTIN_PROVIDERS) {
        providers[id]={...(providers[id]||{}),enabled:false};
    }
    providers.paseodog={...(providers.paseodog||{}),enabled:true,command:[process.execPath,enginePath],env:{...(providers.paseodog?.env||{}),...engineEnv,MIXDOG_HOME:nativeHome,MIXDOG_DATA_DIR:join(nativeHome,'data'),PASEODOG_STATE_DIR:stateDir}};
    const baseDaemon=previous.daemon||{listen:defaultListen,hostnames:['localhost','127.0.0.1'],relay:{enabled:false}};
    const daemon=Array.isArray(baseDaemon.agentProfiles)
        ? {...baseDaemon,agentProfiles:baseDaemon.agentProfiles.filter((profile)=>profile?.provider==='paseodog')}
        : baseDaemon;
    const {defaultProvider:_ignoredDefaultProvider,...restAgents}=previous.agents||{};
    // Never add plugin source entries by hand: Paseo owns their install lifecycle.
    const config={...previous,version:1,pluginsEnabled:true,daemon,
        // 웹 활성화·인증 설정과 사용자 지정 경로는 보존하고 기본 산출물 위치만 공유 소스로 전환한다.
        features:{...previous.features,webUi:{...previous.features?.webUi,
            distDir:previous.features?.webUi?.distDir ?? serverWebDist}},
        agents:{...restAgents,providers}};
    if(existsSync(file))copyFileSync(file,`${file}.backup-${Date.now()}-${randomUUID().slice(0,8)}`,constants.COPYFILE_EXCL);
    const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);
    return file;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    const homeIdx=process.argv.indexOf('--home');
    const customHome=homeIdx!==-1&&process.argv[homeIdx+1]?resolve(process.argv[homeIdx+1]):paseoHome;
    try{console.log(configure({home:customHome,trustPlugins:process.argv.includes('--trust-plugins')}));}
    catch(e){console.error(e.message);process.exitCode=1;}
}
