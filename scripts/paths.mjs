import { homedir, tmpdir } from 'node:os';
import { dirname, resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 테스트·릴리즈 스크래치 루트: PASEODOG_TMP, 없으면 기존 공용 경로가 준비된 기기에서는 그 경로, 그 외에는 OS 임시 폴더.
const sharedScratch = '/data/tmp/ubuntu';
export const scratchRoot = resolve(process.env.PASEODOG_TMP
    || (existsSync(sharedScratch) ? sharedScratch : tmpdir()));
export const scratchPath = (name) => join(scratchRoot, name);
const defaultStateRoot = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA, 'paseodog')
    : join(homedir(), '.local', 'share', 'paseodog');
export const stateRoot = resolve(process.env.PASEODOG_HOME || defaultStateRoot);
export const paseoHome = join(stateRoot, 'paseo');
export const mixdogHome = join(stateRoot, 'mixdog');
export const mixdogDataDir = join(mixdogHome, 'data');
export const journalRoot = join(stateRoot, 'sessions');
// npm .bin 셸 래퍼 대신 패키지 진입 파일을 현재 Node로 직접 실행한다 (Windows 호환).
export const paseoBin = join(root, 'tools', 'node_modules', '@getpaseo', 'cli', 'bin', 'paseo');
export const nativeBin = join(root, 'engine', 'node_modules', 'mixdog', 'src', 'cli.mjs');
export const worker = join(root, 'engine', 'bin', 'paseodog-engine.mjs');
export const launcherPath = process.platform === 'win32'
    ? join(stateRoot, 'bin', 'paseodog.cmd')
    : join(homedir(), '.local', 'bin', 'paseodog');
export const installCommand = process.platform === 'win32' ? 'node scripts/install.mjs' : 'bash scripts/install.sh';
// Paseo에 저장된 연결 경로·모델 선택만 재사용하며 토큰 내용은 읽지 않는다.
export function providerEnvironment(home = paseoHome) {
    let config;
    try { config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    const saved = config.agents?.providers?.paseodog?.env || {};
    const keys = ['OPENAI_OAUTH_CREDENTIALS_PATH', 'PASEODOG_PROVIDER', 'PASEODOG_MODEL',
        'PASEODOG_EFFORT', 'PASEODOG_AUTO_EFFORT', 'PASEODOG_FAST', 'PASEODOG_MODELS', 'PASEODOG_ENABLE_WORKER'];
    return Object.fromEntries(keys.filter((key) => typeof saved[key] === 'string')
        .map((key) => [key, saved[key]]));
}
export const runtimeEnv = () => {
    // Never inherit a parent Mixdog profile or a Node loader override.
    const { NODE_OPTIONS: _options, NODE_PATH: _nodePath, ...base } = process.env;
    // Windows keeps the key as "Path"; replace it instead of adding a second PATH.
    const pathKey = Object.keys(base).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    const inheritedPath = base[pathKey] || '';
    delete base[pathKey];
    return { ...base, ...providerEnvironment(), PASEO_HOME: paseoHome, MIXDOG_HOME: mixdogHome,
        MIXDOG_DATA_DIR: mixdogDataDir, PASEODOG_STATE_DIR: journalRoot,
        PATH: [dirname(process.execPath), join(root,'tools','node_modules','.bin'), inheritedPath].join(delimiter) };
};
export function supportedNode(version = process.versions.node) {
    const [major,minor] = version.split('.').map(Number);
    return major === 22 && minor >= 19 || major >= 24;
}
