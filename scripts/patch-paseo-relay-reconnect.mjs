import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchedRelayReconnectSource } from '../patches/paseo-relay-reconnect.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RELAY_RECONNECT_FILE = 'dist/server/server/relay-transport.js';

export function patchPaseoRelayReconnect(
    base = resolve(root, 'tools/node_modules/@getpaseo/server'), { check = false } = {},
) {
    if (JSON.parse(readFileSync(resolve(base, 'package.json'), 'utf8')).version !== '0.11.4')
        throw new Error('Paseo relay reconnect requires 0.11.4');
    const path = resolve(base, RELAY_RECONNECT_FILE);
    const before = readFileSync(path, 'utf8');
    const after = patchedRelayReconnectSource(before);
    if (check && before !== after) throw new Error('Paseo relay reconnect patch is missing');
    if (!check && before !== after) writeFileSync(path, after);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { patchPaseoRelayReconnect(undefined, { check: process.argv.includes('--check') }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
