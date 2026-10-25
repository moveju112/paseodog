import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, mkdtempSync, rmSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    RELAY_PASSWORD_PATCHES, patchedRelayPasswordSource, relayPasswordModule, patchPaseoRelayPassword,
} from '../scripts/patch-paseo-relay-password.mjs';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';
import { RELAY_PASSWORD_WEB_EDITS, withoutRelayPassword } from '../patches/paseo-relay-password.mjs';
import { en } from '../android/packages/app/src/i18n/resources/en.ts';
import { pluginSettings } from '../android/packages/app/src/i18n/resources/plugin-settings.ts';

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
            assert.throws(() => patchedRelayPasswordSource(patched.replace(after, () => before), spec), /Partial|hash mismatch/);
        }
    }
});

test('the complete installed patch upgrades reviewed helpers and checks without modifying files', (t) => {
    const directory = privateHome(t);
    for (const spec of RELAY_PASSWORD_PATCHES) {
        const target = join(directory, spec.package, spec.file);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(new URL(`${spec.package}/${spec.file}`, packageRoot), target);
        cpSync(new URL(`${spec.package}/package.json`, packageRoot), join(directory, spec.package, 'package.json'));
    }
    const helper = join(directory, 'server/dist/server/server/relay-password.js');
    cpSync(new URL('relay-password.js', serverRoot), helper);
    const before = readFileSync(helper, 'utf8');
    assert.throws(() => patchPaseoRelayPassword(directory, { check: true }), /patch is missing/);
    assert.equal(readFileSync(helper, 'utf8'), before);
    patchPaseoRelayPassword(directory);
    const modified = statSync(helper).mtimeMs;
    patchPaseoRelayPassword(directory, { check: true });
    patchPaseoRelayPassword(directory);
    assert.equal(statSync(helper).mtimeMs, modified);
    assert.equal(readFileSync(helper, 'utf8'), relayPasswordModule());
    writeFileSync(helper, `${relayPasswordModule()}\n// unexpected drift\n`);
    assert.throws(() => patchPaseoRelayPassword(directory), /helper drift/);
});

test('pairing links use the password-enabled web, migrate the old default, and preserve custom hosting', async (t) => {
    const home = privateHome(t);
    const helper = await loadSource(relayPasswordModule(), new URL('relay-password.js', serverRoot));
    const spec = RELAY_PASSWORD_PATCHES.find((entry) => entry.file.endsWith('/pairing-offer.js'));
    const { module } = await loadSource(patchedRelayPasswordSource(installed(spec), spec),
        new URL(spec.file, new URL('server/', packageRoot)), { [new URL('relay-password.js', serverRoot).href]: helper.url });
    const args = { paseoHome: home, relayEnabled: true, includeQr: false, password: 'separate-relay-secret' };
    for (const appBaseUrl of [undefined, 'https://app.paseo.sh', 'https://app.paseo.sh/',
        'https://moveju112.github.io/paseodog', 'https://moveju112.github.io/paseodog/']) {
        const { url } = await module.generateLocalPairingOffer({ ...args, appBaseUrl });
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'https://paseodog.choondoggy.com');
        assert.equal(parsed.pathname, '/');
        assert.match(parsed.hash, /^#offer=/);
        assert.ok(!url.includes(args.password));
    }
    const { url } = await module.generateLocalPairingOffer({ ...args, appBaseUrl: 'https://example.test/custom/' });
    assert.ok(url.startsWith('https://example.test/custom/#offer='));
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
    // 바이트가 아닌 글자 수로 새 암호 길이를 판단한다(4글자·12바이트 거부).
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password: '짧은암호' }), /at least 8 characters/);
    assert.equal(existsSync(join(home, 'relay-password')), false);
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
    const helper = await loadSource(relayPasswordModule(), new URL('relay-password.js', serverRoot));
    await helper.module.requireRelayPassword(home, 'relay-secret');
    const spec = RELAY_PASSWORD_PATCHES.find((spec) => spec.file.endsWith('/session-admission-auth.js'));
    const { module } = await loadSource(patchedRelayPasswordSource(installed(spec), spec),
        new URL('session-admission-auth.js', serverRoot), { [new URL('relay-password.js', serverRoot).href]: helper.url });
    const base = { transport: 'relay', paseoHome: home, passwordHash: undefined, localCredential: 'local-token' };
    assert.deepEqual(await module.resolveSessionAdmission({ ...base, credential: undefined }), { rejection: 'password_required' });
    assert.deepEqual(await module.resolveSessionAdmission({ ...base, credential: { kind: 'password', password: 'relay-secret' } }),
        { rejection: 'password_required' });
    const relayPasswordHash = helper.module.readRelayPasswordHash(home);
    for (const credential of [undefined, { kind: 'password', password: 'wrong' }, { kind: 'localCredential', token: 'local-token' }]) {
        assert.ok('rejection' in await module.resolveSessionAdmission({ ...base, relayPasswordHash, credential }));
    }
    assert.equal((await module.resolveSessionAdmission({
        ...base, relayPasswordHash, credential: { kind: 'password', password: 'relay-secret' },
    })).admission.principalId, 'owner');
    assert.equal((await module.resolveSessionAdmission({ ...base, transport: 'direct', credential: undefined })).admission.principalId, 'owner');
});

test('existing short relay passwords still verify while new short passwords are refused', async (t) => {
    const home = privateHome(t);
    const { module: helper } = await loadSource(relayPasswordModule(), new URL('relay-password.js', serverRoot));
    await assert.rejects(helper.requireRelayPassword(home, 'short'), /at least 8 characters/);
    const { hashSync } = await import(new URL('../tools/node_modules/bcryptjs/index.js', import.meta.url).href);
    writeFileSync(join(home, 'relay-password'), `${hashSync('short', 12)}\n`, { mode: 0o600 });
    await helper.requireRelayPassword(home, 'short');
    await assert.rejects(helper.requireRelayPassword(home, 'shorter'), /Incorrect relay password/);
});

test('relay lockout persists after five consecutive failures and only access reset unlocks it', async (t) => {
    const home = privateHome(t);
    const helper = await loadSource(relayPasswordModule(), new URL('relay-password.js', serverRoot));
    await helper.module.requireRelayPassword(home, 'relay-secret');
    const spec = RELAY_PASSWORD_PATCHES.find((spec) => spec.file.endsWith('/session-admission-auth.js'));
    const { module } = await loadSource(patchedRelayPasswordSource(installed(spec), spec) + '\n// throttle test\n',
        new URL('session-admission-auth.js', serverRoot), { [new URL('relay-password.js', serverRoot).href]: helper.url });
    const input = { transport: 'relay', paseoHome: home, passwordHash: undefined, localCredential: null };
    const login = (password) => module.resolveSessionAdmission({ ...input,
        relayPasswordHash: helper.module.readRelayPasswordHash(home), credential: { kind: 'password', password } });
    for (let index = 0; index < 4; index++) assert.deepEqual(await login('wrong'), { rejection: 'incorrect_password' });
    assert.ok('admission' in await login('relay-secret'));
    for (let index = 0; index < 5; index++) assert.deepEqual(await login('wrong'), { rejection: 'incorrect_password' });
    assert.deepEqual(await login('relay-secret'), { rejection: 'incorrect_password' });
    const stateFile = join(home, 'relay-login-failures');
    assert.equal(statSync(stateFile).mode & 0o777, 0o600);
    assert.equal(readFileSync(stateFile, 'utf8'), '5\n');
    const restarted = await loadSource(relayPasswordModule() + '\n// fresh process state\n', new URL('relay-password.js', serverRoot));
    assert.equal(await restarted.module.verifyRelayLoginPassword(home, 'relay-secret', helper.module.readRelayPasswordHash(home)), false);
    await helper.module.requireRelayPassword(home, 'relay-secret');
    assert.deepEqual(await login('relay-secret'), { rejection: 'incorrect_password' });
    assert.ok('admission' in await module.resolveSessionAdmission({ ...input, transport: 'direct', credential: undefined }));
    await helper.module.resetRelayAccess(home, 'new-relay-secret');
    assert.equal(existsSync(stateFile), false);
    assert.ok('admission' in await login('new-relay-secret'));
});

// 원본에 앞쪽 편집 N개만 적용한 이전 배포본은 업그레이드하고, 그 밖의 중간 상태는 거부한다.
test('edit patches upgrade the exact previous release state and refuse other partial states', () => {
    for (const spec of RELAY_PASSWORD_PATCHES.filter((entry) => entry.legacyEditCounts)) {
        let original = patchedRelayPasswordSource(installed(spec), spec);
        for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, () => before);
        const patched = patchedRelayPasswordSource(original, spec);
        for (const count of spec.legacyEditCounts) {
            const legacy = spec.edits.slice(0, count).reduce((text, [before, after]) => text.replace(before, () => after), original);
            assert.equal(patchedRelayPasswordSource(legacy, spec), patched);
        }
        const [before, after] = spec.edits.at(-1);
        const skippedFirst = spec.edits.slice(1).reduce((text, [b, a]) => text.replace(b, () => a), original);
        if (skippedFirst !== original) assert.throws(() => patchedRelayPasswordSource(skippedFirst, spec), /Partial|hash mismatch|anchor/);
        assert.ok(patched.includes(after) && !patched.includes(before + before));
    }
});

// 잊은 암호 재설정: 새 해시·새 데몬 키로 이전 암호·주소를 무효화하고, 손상 파일도 복구하며 Hub 연결은 보호한다.
test('relay reset replaces the password, rotates the link key, recovers corrupt state, and protects Hub enrollment', async (t) => {
    const home = privateHome(t);
    const helper = await loadSource(relayPasswordModule(), new URL('relay-password.js', serverRoot));
    const spec = RELAY_PASSWORD_PATCHES.find((entry) => entry.file.endsWith('/pairing-offer.js'));
    const { module } = await loadSource(patchedRelayPasswordSource(installed(spec), spec),
        new URL(spec.file, new URL('server/', packageRoot)), { [new URL('relay-password.js', serverRoot).href]: helper.url });
    const args = { paseoHome: home, relayEnabled: true, includeQr: false };
    const first = await module.generateLocalPairingOffer({ ...args, password: 'forgotten-secret' });
    const keyFile = join(home, 'daemon-keypair.json');
    const firstKey = JSON.parse(readFileSync(keyFile, 'utf8')).publicKeyB64;
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password: 'short', reset: true }), /at least 8 characters/);
    assert.equal(JSON.parse(readFileSync(keyFile, 'utf8')).publicKeyB64, firstKey);
    const reset = await module.generateLocalPairingOffer({ ...args, password: 'brand-new-secret', reset: true });
    const secondKey = JSON.parse(readFileSync(keyFile, 'utf8')).publicKeyB64;
    assert.notEqual(secondKey, firstKey);
    assert.notEqual(reset.url, first.url);
    assert.ok(!decodeURIComponent(reset.url).includes('brand-new-secret'));
    assert.equal(statSync(join(home, 'relay-password')).mode & 0o777, 0o600);
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password: 'forgotten-secret' }), /Incorrect relay password/);
    assert.equal((await module.generateLocalPairingOffer({ ...args, password: 'brand-new-secret' })).url, reset.url);
    writeFileSync(join(home, 'relay-password'), 'corrupt');
    await module.generateLocalPairingOffer({ ...args, password: 'recovered-secret', reset: true });
    await module.generateLocalPairingOffer({ ...args, password: 'recovered-secret' });
    writeFileSync(join(home, 'hub-relationship.json'), '{}');
    const keyBeforeHub = readFileSync(keyFile, 'utf8'), hashBeforeHub = readFileSync(join(home, 'relay-password'), 'utf8');
    await assert.rejects(module.generateLocalPairingOffer({ ...args, password: 'another-secret', reset: true }), /Disconnect Paseo Hub/);
    assert.equal(readFileSync(keyFile, 'utf8'), keyBeforeHub);
    assert.equal(readFileSync(join(home, 'relay-password'), 'utf8'), hashBeforeHub);
});

test('web issuance and address/password entry remain hash gated and reversible', () => {
    const source = readFileSync(new URL(`server/${COMPOSER_FILE}`, packageRoot), 'utf8');
    const patched = composerFixture(source);
    assert.equal(composerFixture(patched), patched);
    assert.equal(patchedComposerSource(withoutRelayPassword(patched)), patched);
    assert.throws(() => patchedComposerSource(source + '// drift'), /hash mismatch/);
    // 재설정 화면·한국어 문구·재설정 요청 전달이 들어가고, 주소 입력창의 무조건 차단은 빠진다.
    for (const marker of ['pair-device-reset-toggle', 'reset:reset', '...(e?.reset?{reset:!0}:{})', 'resetToggle:"\\ube44']) assert.ok(patched.includes(marker), marker);
    assert.ok(!patched.includes('try{if(!O){U(R("pairing.hostPassword.label"));return}'));
    assert.ok(patched.includes('const e=await z.submit(n,O||void 0)'));
});

test('pairing UI looks up links and explains stable links and password resets on desktop and mobile', () => {
    const koSource = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/i18n/resources/ko.ts', import.meta.url), 'utf8'))
        .replace(/^import .*$/gm, '').replace('export const ko', 'const ko');
    const ko = new Function('en', 'pluginSettings', `${koSource};return ko;`)(en, pluginSettings);
    const source = RELAY_PASSWORD_WEB_EDITS.find(([before]) => before.startsWith('e.PairDeviceSection='))[1];
    const webTranslations = RELAY_PASSWORD_WEB_EDITS
        .filter(([before]) => before.startsWith('device:{loadingOffer:'))
        .map(([, after]) => new Function(`return ({${after.slice('device:{'.length)}});`)());
    const element = (type, props) => ({ type, props });
    for (const resource of [en, ko]) {
        const web = webTranslations.find((device) => device.loadingOffer === resource.pairing.device.loadingOffer);
        for (const key of ['generateLink', 'linkHelpLabel', 'linkHelp', 'passwordLabel']) {
            assert.equal(web[key], resource.pairing.device[key], key);
        }
        const translate = (key) => key.split('.').reduce((value, part) => value[part], resource);
        for (const resetMode of [false, true]) {
            for (const url of [null, 'https://example.test/#offer=existing']) {
                let stateIndex = 0, queryIndex = 0, mutationIndex = 0;
                const client = { getLastServerInfoMessage: () => ({ features: {
                    relayPasswordAuth: true, daemonStatusRpc: true, relayConfig: true,
                } }) };
                const deps = {
                    e: {}, y: { useTranslation: () => ({ t: translate }) },
                    w: { useHostRuntimeClient: () => client, useHostRuntimeSnapshot: () => ({ connectionStatus: 'online' }) },
                    S: { useDaemonConfig: () => ({ patchConfig: () => {} }) },
                    s: { useState: () => [[false, 'existing-password', 0, resetMode][stateIndex++], () => {}] },
                    j: { useFetchQuery: () => queryIndex++ === 0 ? { data: { relayEnabled: true, url } } : {} },
                    _: { daemonPairingOfferQueryKey: () => [] },
                    u: { useMutation: () => mutationIndex++ === 0 ? {} : { isPending: false } },
                    n: { View: 'View' }, t: { Text: 'Text' }, C: { jsx: element, jsxs: element },
                    H: {}, R: { EditingTextInput: 'Input' }, b: { Button: 'Button' }, h: { Alert: 'Alert' },
                    I: 'PairDeviceBody',
                    r: () => ({ Tooltip: 'Tooltip', TooltipTrigger: 'TooltipTrigger', TooltipContent: 'TooltipContent' }),
                    _d: [],
                };
                const render = new Function(...Object.keys(deps), `${source};return e.PairDeviceSection;`)(...Object.values(deps));
                const tree = render({ serverId: 'test-server', onClose: () => {} });
                const nodes = [];
                const visit = (node) => {
                    if (!node || typeof node !== 'object') return;
                    nodes.push(node);
                    const children = node.props?.children;
                    for (const child of Array.isArray(children) ? children : [children]) visit(child);
                };
                visit(tree);
                const tooltip = nodes.find((node) => node.type === 'Tooltip');
                assert.equal(tooltip.props.enabledOnDesktop, true);
                assert.equal(tooltip.props.enabledOnMobile, true);
                assert.ok(nodes.some((node) => node.props?.children === resource.pairing.device.linkHelp));
                const action = nodes.find((node) => node.props?.testID === 'pair-device-generate');
                if (url) assert.equal(action, undefined);
                else assert.equal(action.props.children, resetMode
                    ? resource.pairing.device.resetAndGenerate : resource.pairing.device.generateLink);
            }
        }
    }
    assert.equal(ko.pairing.device.generateLink, '주소 조회');
    assert.equal(en.pairing.device.generateLink, 'Look up link');
    assert.match(ko.pairing.device.linkHelp, /다시 조회하거나 재시작해도 주소가 같아요/);
    assert.match(ko.pairing.device.linkHelp, /비밀번호 재설정 시 주소도 바뀌며/);
});
