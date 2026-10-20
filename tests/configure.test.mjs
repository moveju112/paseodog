import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configure} from '../scripts/configure.mjs';
import {supportedNode,providerEnvironment} from '../scripts/paths.mjs';
function setup(t){const root=mkdtempSync(join(tmpdir(),'paseodog-config-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,options:{home:join(root,'paseo'),nativeHome:join(root,'mixdog'),stateDir:join(root,'sessions'),enginePath:'/path with space/worker.mjs'}};}
test('configure requires explicit trust and does not enable plugins silently',t=>{const {options}=setup(t);assert.throws(()=>configure(options),/trust-plugins/);});
test('configure preserves unrelated config, disables non-paseodog built-in providers, and uses absolute argv with no shell',t=>{
    const {root,options}=setup(t);mkdirSync(options.home,{mode:0o700});writeFileSync(join(options.home,'config.json'),JSON.stringify({version:1,daemon:{listen:'127.0.0.1:9999'},agents:{providers:{existing:{enabled:true},opencode:{enabled:true},pi:{enabled:true},omp:{enabled:true},customAcp:{extends:'acp',enabled:true}}}}));
    const file=configure({...options,trustPlugins:true});const config=JSON.parse(readFileSync(file,'utf8'));assert.equal(config.daemon.listen,'127.0.0.1:9999');assert.equal(config.agents.providers.existing.enabled,true);assert.equal(config.agents.providers.opencode.enabled,false);assert.equal(config.agents.providers.pi.enabled,false);assert.equal(config.agents.providers.omp.enabled,false);assert.equal(config.agents.providers.customAcp,undefined);assert.equal(config.agents.defaultProvider,undefined);assert.deepEqual(config.agents.providers.paseodog.command,[process.execPath,options.enginePath]);assert.equal(config.plugins,undefined);assert.ok(readdirSync(options.home).some(x=>x.includes('backup')));
});
test('malformed existing config fails without replacing it',t=>{const {options}=setup(t);mkdirSync(options.home,{mode:0o700});const file=join(options.home,'config.json');writeFileSync(file,'broken');assert.throws(()=>configure({...options,trustPlugins:true}));assert.equal(readFileSync(file,'utf8'),'broken');});
// 최초 설정은 모델·개인 에이전트를 주입하지 않고 사용자가 켠 상태는 재설정 시 보존한다.
test('agent defaults contain no seeded routes or custom definitions and preserve enabled choices', (t) => {
    const { options } = setup(t);
    configure({ ...options, trustPlugins: true });
    const data = join(options.nativeHome, 'data');
    const file = join(data, 'mixdog-config.json');
    const initial = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(initial.agent.agents, {});
    assert.deepEqual(initial.agent.enabledAgents, []);
    assert.deepEqual(readdirSync(data), ['mixdog-config.json']);
    initial.agent.enabledAgents = ['worker', 'advisor'];
    writeFileSync(file, JSON.stringify(initial));
    configure({ ...options, trustPlugins: true });
    const restored = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(restored.agent.enabledAgents, ['worker', 'advisor']);
    assert.deepEqual(restored.agent.agents, {});
});
test('Node compatibility checker matches upstream supported ranges',()=>{
    for(const version of ['22.19.0','22.20.1','24.0.0','26.1.0'])assert.equal(supportedNode(version),true);
    for(const version of ['20.20.0','22.16.0','23.9.0'])assert.equal(supportedNode(version),false);
});

test('reconfiguration preserves all explicit user settings and refuses corrupt native data', (t) => {
    const { options } = setup(t);
    configure({ ...options, trustPlugins: true });
    const file = join(options.nativeHome, 'data/mixdog-config.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    Object.assign(saved.agent, {
        profile: { experienceLevel: 'expert', language: 'ko' }, default: { effort: 'high' },
        workflow: { active: 'none' }, worktree: { newTaskDefault: 'direct', branchPrefix: 'custom/' },
        instructionFiles: 'off', skills: { disabled: [] }, compaction: { auto: false },
    });
    writeFileSync(file, JSON.stringify(saved));
    configure({ ...options, trustPlugins: true });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), saved);
    writeFileSync(file, 'broken');
    assert.throws(() => configure({ ...options, trustPlugins: true }));
    assert.equal(readFileSync(file, 'utf8'), 'broken');
});
// 인증 파일은 복사하지 않고 명시적으로 저장된 연결 설정만 읽는다.
test('provider environment reuses explicit OAuth path without inheriting profile overrides or secrets',t=>{
    const {root}=setup(t);
    writeFileSync(join(root,'config.json'),JSON.stringify({agents:{providers:{paseodog:{env:{
        OPENAI_OAUTH_CREDENTIALS_PATH:'/existing/openai-oauth.json',PASEODOG_MODEL:'selected-model',
        MIXDOG_DATA_DIR:'/unrelated',NODE_OPTIONS:'--bad',API_KEY:'do-not-copy',
    }}}}}));
    assert.deepEqual(providerEnvironment(root),{
        OPENAI_OAUTH_CREDENTIALS_PATH:'/existing/openai-oauth.json',PASEODOG_MODEL:'selected-model',
    });
    writeFileSync(join(root,'config.json'),'invalid');
    assert.throws(()=>providerEnvironment(root));
});
