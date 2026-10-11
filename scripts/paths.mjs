import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const stateRoot = resolve(process.env.PASEODOG_HOME || join(homedir(), '.local', 'share', 'paseodog'));
export const paseoHome = join(stateRoot, 'paseo');
export const mixdogHome = join(stateRoot, 'mixdog');
export const journalRoot = join(stateRoot, 'sessions');
export const paseoBin = join(root, 'tools', 'node_modules', '.bin', 'paseo');
export const nativeBin = join(root, 'engine', 'node_modules', '.bin', 'mixdog');
export const worker = join(root, 'engine', 'bin', 'paseodog-engine.mjs');
export const runtimeEnv = () => ({...process.env, PASEO_HOME: paseoHome, MIXDOG_HOME: mixdogHome, PASEODOG_STATE_DIR: journalRoot,
    PATH: `${dirname(process.execPath)}:${join(root,'tools','node_modules','.bin')}:${process.env.PATH || ''}`});
export function supportedNode(version = process.versions.node) {
    const [major,minor] = version.split('.').map(Number);
    return major === 22 && minor >= 19 || major >= 24;
}
