import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    RELAY_PASSWORD_PATCHES, patchedRelayPasswordSource, relayPasswordModule,
} from '../scripts/patch-paseo-relay-password.mjs';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { withoutRelayPassword } from '../patches/paseo-relay-password.mjs';

const packageRoot = new URL('../tools/node_modules/@getpaseo/', import.meta.url);
const serverRoot = new URL('server/dist/server/server/', packageRoot);
const require = createRequire(new URL('server/package.json', packageRoot));
const installed = (spec) => readFileSync(new URL(`${spec.package}/${spec.file}`, packageRoot), 'utf8');

// 설치본을 변경하지 않고 검토된 실제 모듈을 메모리에서 실행한다.
async function loadSource(source, base, overrides = {}) {
    const rewritten = source.replace(/from "([^"]+)"/g, (match, name) => {
        if (name.startsWith('node:')) return match;
        const target = name === 'bcryptjs' ? new URL('../tools/node_modules/bcryptjs/index.js', import.meta.url).href
            : name.startsWith('.') ? new URL(name, base).href : pathToFileURL(require.resolve(name)).href;
        return `from "${overrides[target] ?? target}"`;
    });
    const url = `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`;
    return { url, module: await import(url) };
}

// 고유 테스트 홈은 테스트 종료 시 제거한다(실패 시에도 정리).
function privateHome(t) {
    const home = mkdtempSync(join(tmpdir(), 'paseodog-relay-password-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    return home;
}

test('reviewed relay patches are idempotent and refuse source drift or partial application', () => {
    for (const spec of RELAY_PASSWORD_PATCHES) {
        const source = installed(spec);
        const patched = patchedRelayPasswordSource(source, spec);
        assert.equal(patchedRelayPasswordSource(patched, spec), patched);
        assert.throws(() => patchedRelayPasswordSource(source + '// drift', spec), /hash mismatch/);
        if (spec.edits?.length > 1) {
            const [before, after] = spec.edits[0];
            assert.throws(() => patchedRelayPasswordSource(patched.replace(after, () => before), spec), /Partial/);
        }
    }
});

test('relay issuance stores only a private hash, confirms reissue, and never embeds passwords', async (t) => {
    const home = privateHome(t);
    const helper = await loadSource(relayPasswordModule(), new URL('relay-password.js', serverRoot));
    const spec = RELAY_PASSWORD_PATCHES.find((spec) => spec.file.endsWith('/pairing-offer.js'));
    const { module } = await loadSource(patchedRelayPasswordSource(installed(spec), spec),
        new URL(spec.file, new URL('server/', packageRoot)), { [new URL('relay-password.js', serverRoot).href]: helper.url });
    const args = { paseoHome: home, relayEnabled: true, includeQr: false };
    assert.deepEqual(await module.generateLocalPairingOffer(args), { relayEnabled: true, url: null, qr: null });
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password: '' }), /1–72/);
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password: '가'.repeat(25) }), /1–72/);
    const password = '별도 relay password';
    const offer = await module.generateLocalPairingOffer({ ...args, password });
    const hash = readFileSync(join(home, 'relay-password'), 'utf8');
    assert.match(hash, /^\$2[aby]\$12\$/);
    assert.ok(!hash.includes(password));
    assert.equal(statSync(join(home, 'relay-password')).mode & 0o777, 0o600);
    assert.ok(offer.url.includes('#offer='));
    assert.ok(!decodeURIComponent(offer.url).includes(password));
    assert.ok(!offer.url.includes('password'));
    assert.equal((await module.generateLocalPairingOffer({ ...args, password })).url, offer.url);
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password: 'wrong' }), /Incorrect relay password/);
    assert.equal(readFileSync(join(home, 'relay-password'), 'utf8'), hash);
    writeFileSync(join(home, 'relay-password'), 'corrupt');
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password }), /Invalid relay password file/);
});

test('relay admission fails closed without configuration, requires the exact password, and keeps local auth', async (t) => {
    const home = privateHome(t);
    const { module: helper } = await loadSource(relayPasswordModule(), new URL('relay-password.js', serverRoot));
    await helper.requireRelayPassword(home, 'relay-secret');
    const spec = RELAY_PASSWORD_PATCHES.find((spec) => spec.file.endsWith('/session-admission-auth.js'));
    const { module } = await loadSource(patchedRelayPasswordSource(installed(spec), spec),
        new URL('session-admission-auth.js', serverRoot));
    const base = { transport: 'relay', passwordHash: undefined, localCredential: 'local-token' };
    assert.deepEqual(await module.resolveSessionAdmission({ ...base, credential: undefined }), { rejection: 'password_required' });
    assert.deepEqual(await module.resolveSessionAdmission({ ...base, credential: { kind: 'password', password: 'relay-secret' } }),
        { rejection: 'password_required' });
    const relayPasswordHash = helper.readRelayPasswordHash(home);
    for (const credential of [undefined, { kind: 'password', password: 'wrong' }, { kind: 'localCredential', token: 'local-token' }]) {
        assert.ok('rejection' in await module.resolveSessionAdmission({ ...base, relayPasswordHash, credential }));
    }
    assert.equal((await module.resolveSessionAdmission({
        ...base, relayPasswordHash, credential: { kind: 'password', password: 'relay-secret' },
    })).admission.principalId, 'owner');
    assert.equal((await module.resolveSessionAdmission({ ...base, transport: 'direct', credential: undefined })).admission.principalId, 'owner');
});

test('web issuance and address/password entry remain hash gated and reversible', () => {
    const source = readFileSync(new URL(`server/${COMPOSER_FILE}`, packageRoot), 'utf8');
    const patched = patchedComposerSource(source);
    assert.equal(patchedComposerSource(patched), patched);
    assert.equal(withoutRelayPassword(patched), withoutRelayPassword(source));
    assert.throws(() => patchedComposerSource(source + '// drift'), /hash mismatch/);
});
