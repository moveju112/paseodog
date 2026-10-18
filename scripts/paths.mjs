import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const stateRoot = resolve(process.env.PASEODOG_HOME || join(homedir(), '.local', 'share', 'paseodog'));
export const paseoHome = join(stateRoot, 'paseo');
export const mixdogHome = join(stateRoot, 'mixdog');
export const mixdogDataDir = join(mixdogHome, 'data');
export const journalRoot = join(stateRoot, 'sessions');
export const paseoBin = join(root, 'tools', 'node_modules', '.bin', 'paseo');
export const nativeBin = join(root, 'engine', 'node_modules', '.bin', 'mixdog');
export const worker = join(root, 'engine', 'bin', 'paseodog-engine.mjs');
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
    return { ...base, ...providerEnvironment(), PASEO_HOME: paseoHome, MIXDOG_HOME: mixdogHome,
        MIXDOG_DATA_DIR: mixdogDataDir, PASEODOG_STATE_DIR: journalRoot,
        PATH: `${dirname(process.execPath)}:${join(root,'tools','node_modules','.bin')}:${process.env.PATH || ''}` };
};
export function supportedNode(version = process.versions.node) {
    const [major,minor] = version.split('.').map(Number);
    return major === 22 && minor >= 19 || major >= 24;
}
