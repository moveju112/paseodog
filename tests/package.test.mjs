import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const MARKER='PASEODOG-LEAK-MARKER';
const CANONICAL='canonical agent rules\n';
// 새 런타임 의존성과 배포 명령이 허용 목록에서 누락되면 배포 전에 실패한다.
test('source allowlist includes required runtime modules and release commands', () => {
    const entries = new Set(readFileSync(join(root, 'MANIFEST.sha256'), 'utf8').trim().split('\n')
        .map((line) => line.split('  ')[1]));
    for (const path of ['engine/src/session-actions.mjs', 'engine/src/resource-controls.mjs',
        'plugin/client/session-tools.tsx', 'plugin/client/resource-settings.tsx', 'tests/native-session-features.test.mjs',
        'engine/src/orchestration.mjs', 'plugin/server/compaction.mjs',
        'patches/effort-usage.mjs', 'tests/worktree-setup-tip.test.mjs', 'scripts/android-update-manifest.py',
        'scripts/check-upstream.mjs', 'scripts/live-acceptance.mjs',
        'android/scripts/build-package.mjs', 'android/scripts/clean-package-dist.mjs',
        'android/scripts/is-main-module.mjs', 'tests/incremental-build.test.mjs',
        'android/scripts/build-daemon-web-ui.mjs', 'tests/web-compression.test.mjs',
        'patches/agent-editor-safety.mjs', 'patches/paseo-agent-editor-safety.mjs',
        'tests/agent-editor-safety.test.mjs', 'patches/paseo-chat-usability.mjs',
        'android/packages/app/src/usage/pin-compatibility.ts', 'tests/chat-usability.test.mjs',
        'patches/paseo-soft-light-themes.mjs', 'android/packages/app/src/styles/soft-light-palettes.ts'])
        assert.ok(entries.has(path), `Required release source missing: ${path}`);
});
test('source archive has valid hashes, safe paths and no runtime state or dependencies',t=>{
    const dir=mkdtempSync(join(tmpdir(),'paseodog-package-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const output=join(dir,'release.zip');const built=spawnSync('python3',['scripts/package.py','--output',output],{cwd:root,encoding:'utf8'});assert.equal(built.status,0,built.stderr);
    const check=spawnSync('python3',['-c',`import zipfile,hashlib,stat,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names=z.namelist()\n assert all(n.startswith('paseodog/') and '..' not in n.split('/') for n in names)\n assert all('node_modules/' not in n and '.local.' not in n for n in names)\n for line in z.read('paseodog/MANIFEST.sha256').decode().splitlines():\n  digest,name=line.split('  ',1)\n  assert hashlib.sha256(z.read('paseodog/'+name)).hexdigest()==digest\n assert z.testzip() is None\n expected={'paseodog/'+line.strip().split('  ',1)[1] for line in open(sys.argv[2])}\n assert set(names)==expected|{'paseodog/MANIFEST.sha256'}\n assert all(stat.S_ISREG(info.external_attr>>16) for info in z.infolist())\n`,output,join(root,'MANIFEST.sha256')],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
});

// 임시 소스 트리 생성 -> 정식 규칙·일반 소스·외부 비밀 파일 기록 (AGENTS.md는 케이스가 구성)
function makeFixture(t){
    const base=mkdtempSync(join(tmpdir(),'paseodog-package-fixture-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
    const repo=join(base,'repo');const outside=join(base,'outside');
    mkdirSync(join(repo,'docs'),{recursive:true});mkdirSync(outside);
    writeFileSync(join(repo,'AI_RULES.md'),CANONICAL);writeFileSync(join(repo,'README.md'),'readme\n');writeFileSync(join(repo,'docs/guide.md'),'guide\n');
    writeFileSync(join(outside,'secret.md'),`${MARKER} external\n`);writeFileSync(join(outside,'guide.md'),`${MARKER} external guide\n`);
    return {repo,outside,output:join(base,'release.zip')};
}

// 허용 목록 기록 (실제 바이트 해시, 읽을 수 없으면 0 해시)
function writeManifest(repo,names){
    const lines=names.map(name=>{let digest='0'.repeat(64);try{digest=createHash('sha256').update(readFileSync(join(repo,name))).digest('hex');}catch{}return `${digest}  ${name}\n`;});
    writeFileSync(join(repo,'MANIFEST.sha256'),lines.join(''));
}

// importlib로 package() 호출 -> 결과·예외·ZIP 항목(해시·모드·누출 여부) JSON 반환
function runPackage(repo,output){
    const script=`import importlib.util,json,sys,zipfile,hashlib\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('paseodog_package',sys.argv[1])\nmodule=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\nrepo,output,marker=Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[4].encode()\nresult={'entries':{}}\ntry:\n module.package(repo,output)\n result['ok']=True\nexcept Exception as error:\n result['ok']=False\n result['error']=type(error).__name__+': '+str(error)\nif output.exists():\n with zipfile.ZipFile(output) as z:\n  result['crc']=z.testzip() is None\n  for info in z.infolist():\n   content=z.read(info)\n   result['entries'][info.filename]={'sha256':hashlib.sha256(content).hexdigest(),'mode':info.external_attr>>16,'leak':marker in content,'text':content.decode('utf8','replace')}\nprint(json.dumps(result))\n`;
    const run=spawnSync('python3',['-B','-c',script,join(root,'scripts/package.py'),repo,output,MARKER],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
}

// 성공 ZIP 검증 -> AGENTS.md 일반 파일·기대 바이트, 매니페스트 해시·CRC, 누출 없음
function assertPackagedAgents(result,expected){
    assert.equal(result.ok,true,result.error);assert.equal(result.crc,true);
    const agents=result.entries['paseodog/AGENTS.md'];assert.ok(agents,'AGENTS.md entry missing');
    assert.equal(agents.mode&0o170000,0o100000,'AGENTS.md must be a regular ZIP entry');
    assert.equal(agents.sha256,createHash('sha256').update(expected).digest('hex'));
    const manifest=result.entries['paseodog/MANIFEST.sha256'].text.trim().split('\n');
    for(const line of manifest){const [digest,name]=line.split('  ');assert.equal(result.entries['paseodog/'+name]?.sha256,digest,name);}
    assert.ok(manifest.some(line=>line.endsWith('  AGENTS.md')));
    for(const [name,entry] of Object.entries(result.entries)){assert.ok(name.startsWith('paseodog/'),name);assert.equal(entry.leak,false,name);assert.equal(entry.mode&0o170000,0o100000,name);}
}

test('root AGENTS.md symlink to AI_RULES.md is packaged as a regular file with canonical bytes',t=>{
    for(const target of ['AI_RULES.md','./AI_RULES.md']){
        const {repo,output}=makeFixture(t);symlinkSync(target,join(repo,'AGENTS.md'));
        writeManifest(repo,['AGENTS.md','README.md','docs/guide.md']);
        assertPackagedAgents(runPackage(repo,output),CANONICAL);
    }
});

test('regular AGENTS.md file is still packaged unchanged',t=>{
    const {repo,output}=makeFixture(t);writeFileSync(join(repo,'AGENTS.md'),'regular agents\n');
    writeManifest(repo,['AGENTS.md','README.md','docs/guide.md']);
    assertPackagedAgents(runPackage(repo,output),'regular agents\n');
});

test('altered AGENTS links, unsafe canonical sources and other symlinks are rejected without an archive',t=>{
    const names=['AGENTS.md','README.md','docs/guide.md'];
    // AGENTS.md -> 지정 정식 파일 링크 (정상 케이스 공통 구성)
    const linkAgents=repo=>symlinkSync('AI_RULES.md',join(repo,'AGENTS.md'));
    const cases={
        'another root file':({repo})=>symlinkSync('README.md',join(repo,'AGENTS.md')),
        'absolute canonical path':({repo})=>symlinkSync(join(repo,'AI_RULES.md'),join(repo,'AGENTS.md')),
        'relative external file':({repo})=>symlinkSync('../outside/secret.md',join(repo,'AGENTS.md')),
        'absolute external file':({repo,outside})=>symlinkSync(join(outside,'secret.md'),join(repo,'AGENTS.md')),
        'link chain':({repo})=>{symlinkSync('AI_RULES.md',join(repo,'RULES_LINK.md'));symlinkSync('RULES_LINK.md',join(repo,'AGENTS.md'));},
        'missing canonical source':({repo})=>{rmSync(join(repo,'AI_RULES.md'));linkAgents(repo);},
        'symlinked canonical source':({repo,outside})=>{rmSync(join(repo,'AI_RULES.md'));symlinkSync(join(outside,'secret.md'),join(repo,'AI_RULES.md'));linkAgents(repo);},
        'directory canonical source':({repo})=>{rmSync(join(repo,'AI_RULES.md'));mkdirSync(join(repo,'AI_RULES.md'));writeFileSync(join(repo,'AI_RULES.md/x.md'),MARKER);linkAgents(repo);},
        'nested docs/AGENTS.md':({repo})=>{writeFileSync(join(repo,'AGENTS.md'),'regular agents\n');writeFileSync(join(repo,'docs/AI_RULES.md'),`${MARKER} nested\n`);symlinkSync('AI_RULES.md',join(repo,'docs/AGENTS.md'));return [...names,'docs/AGENTS.md'];},
        'other file symlink':({repo})=>{linkAgents(repo);rmSync(join(repo,'README.md'));symlinkSync('../outside/secret.md',join(repo,'README.md'));},
        'directory symlink':({repo})=>{linkAgents(repo);rmSync(join(repo,'docs'),{recursive:true});symlinkSync('../outside',join(repo,'docs'));},
        'unlisted CLAUDE.md link':({repo})=>{linkAgents(repo);symlinkSync('AI_RULES.md',join(repo,'CLAUDE.md'));return [...names,'CLAUDE.md'];},
        'runtime state path':({repo})=>{linkAgents(repo);mkdirSync(join(repo,'config/state'),{recursive:true});writeFileSync(join(repo,'config/state/session.json'),MARKER);return [...names,'config/state/session.json'];},
        'credential name':({repo})=>{linkAgents(repo);mkdirSync(join(repo,'config'));writeFileSync(join(repo,'config/.env'),MARKER);return [...names,'config/.env'];},
        'dependency path':({repo})=>{linkAgents(repo);mkdirSync(join(repo,'tools/node_modules'),{recursive:true});writeFileSync(join(repo,'tools/node_modules/x.js'),MARKER);return [...names,'tools/node_modules/x.js'];},
        'non-source root file':({repo})=>{linkAgents(repo);writeFileSync(join(repo,'notes.md'),MARKER);return [...names,'notes.md'];},
    };
    for(const [label,setup] of Object.entries(cases)){
        const fixture=makeFixture(t);const listed=setup(fixture)??names;
        mkdirSync(dirname(fixture.output),{recursive:true});writeManifest(fixture.repo,listed);
        const result=runPackage(fixture.repo,fixture.output);
        assert.equal(result.ok,false,`${label} must be rejected`);
        assert.match(result.error,/^RuntimeError:/,`${label} must be rejected by packaging safety checks`);
        assert.deepEqual(Object.keys(result.entries),[],`${label} must not produce archive content`);
    }
});
