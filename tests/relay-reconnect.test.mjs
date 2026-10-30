import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scratchRoot } from '../scripts/paths.mjs';
import { installSteps } from '../scripts/install.mjs';
import { patchedRelayReconnectSource } from '../patches/paseo-relay-reconnect.mjs';
import {
    RELAY_RECONNECT_FILE, patchPaseoRelayReconnect,
} from '../scripts/patch-paseo-relay-reconnect.mjs';

const installedFile = new URL(
    `../tools/node_modules/@getpaseo/server/${RELAY_RECONNECT_FILE}`, import.meta.url);
const source = () => readFileSync(installedFile, 'utf8');

function fixture(t) {
    const directory = mkdtempSync(join(scratchRoot, 'paseodog-relay-reconnect-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, RELAY_RECONNECT_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '0.11.4' }));
    writeFileSync(path, source());
    return { directory, path };
}

test('relay reconnect accepts only the reviewed input or its complete idempotent output', () => {
    const original = source();
    const patched = patchedRelayReconnectSource(original);
    assert.equal(patchedRelayReconnectSource(patched), patched);
    assert.throws(() => patchedRelayReconnectSource(`${original}\n// drift\n`), /hash mismatch/);
    assert.throws(() => patchedRelayReconnectSource(`${patched}\n// partial change\n`), /hash mismatch/);
});

test('relay reconnect check is read-only and apply is idempotent', (t) => {
    const { directory, path } = fixture(t);
    const original = readFileSync(path, 'utf8');
    const expected = patchedRelayReconnectSource(original);
    if (original === expected) {
        assert.doesNotThrow(() => patchPaseoRelayReconnect(directory, { check: true }));
    } else {
        assert.throws(() => patchPaseoRelayReconnect(directory, { check: true }), /patch is missing/);
    }
    assert.equal(readFileSync(path, 'utf8'), original);
    patchPaseoRelayReconnect(directory);
    const patched = readFileSync(path, 'utf8');
    assert.equal(patched, expected);
    const mtime = statSync(path).mtimeMs;
    patchPaseoRelayReconnect(directory, { check: true });
    patchPaseoRelayReconnect(directory);
    assert.equal(readFileSync(path, 'utf8'), patched);
    assert.equal(statSync(path).mtimeMs, mtime);
});

test('relay reconnect rejects version and source drift without modifying the target', (t) => {
    const { directory, path } = fixture(t);
    const original = readFileSync(path, 'utf8');
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '0.11.5' }));
    assert.throws(() => patchPaseoRelayReconnect(directory), /requires 0\.11\.4/);
    assert.equal(readFileSync(path, 'utf8'), original);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '0.11.4' }));
    const drift = `${original}\n// drift\n`;
    writeFileSync(path, drift);
    assert.throws(() => patchPaseoRelayReconnect(directory), /hash mismatch/);
    assert.equal(readFileSync(path, 'utf8'), drift);
});

test('installation applies and checks relay reconnect through the normal patch chain', () => {
    const steps = installSteps('linux', { scope: 'install' });
    const index = steps.findIndex((step) => step.args[0] === 'scripts/patch-paseo-relay-reconnect.mjs');
    assert.ok(index >= 0);
    assert.deepEqual(steps[index + 1].args, ['scripts/patch-paseo-relay-reconnect.mjs', '--check']);
    const manifest = new Set(readFileSync(new URL('../MANIFEST.sha256', import.meta.url), 'utf8')
        .trim().split('\n').map((line) => line.split('  ')[1]));
    for (const path of ['scripts/patch-paseo-relay-reconnect.mjs', 'patches/paseo-relay-reconnect.mjs',
        'android/packages/server/src/server/relay-transport.ts', 'tests/relay-reconnect.test.mjs'])
        assert.ok(manifest.has(path), `Missing release source: ${path}`);
});
