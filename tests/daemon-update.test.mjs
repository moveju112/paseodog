import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createDaemonUpdateCallouts } from '../android/packages/app/src/desktop/updates/daemon-update-callouts.ts';
import { DAEMON_RELEASE } from '../plugin/server/util.mjs';
import { daemonRelease } from '../plugin/shared/controls.ts';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { withDaemonUpdate, withoutDaemonUpdate } from '../patches/paseo-daemon-update.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const manifest = {
    versionCode: 11069, versionName: '1.0.0-rc.7.11069',
};

async function fixture(t, options = {}) {
    const hosts = options.hosts ?? [{ serverId: 'linux', label: 'Linux 호스트' }];
    const cards = new Map(), calls = [], opened = [], fetchURLs = [];
    let connected = options.connected ?? true;
    let result = options.release ?? { version: '1.0.0-rc.7', versionCode: 11068 };
    let update = manifest;
    let fetches = 0;
    const client = {
        async invokePluginRpc(...args) {
            calls.push(args);
            if (result instanceof Error) throw result;
            return result;
        },
    };
    const callouts = {
        show(card) {
            cards.set(card.id, card);
            return () => { if (cards.get(card.id) === card) cards.delete(card.id); };
        },
    };
    const Root = createDaemonUpdateCallouts({
        React, useHosts: () => hosts,
        useClient: () => client, useConnected: () => connected,
        useProvidersSnapshot: () => ({ entries: [{ provider: options.provider ?? 'paseodog' }] }),
        useCallouts: () => callouts,
        openURL: url => opened.push(url),
        fetch: async url => {
            fetches++;
            fetchURLs.push(url);
            if (options.fetchError) throw options.fetchError;
            return { ok: true, json: async () => options.payload === undefined
                ? { tag_name: `v${update.versionName}`, draft: false, prerelease: false }
                : options.payload };
        },
    });
    let root;
    await act(async () => { root = create(React.createElement(Root)); });
    t.after(async () => { await act(async () => root.unmount()); });
    return {
        cards, calls, opened, fetchURLs, get fetches() { return fetches; },
        setRelease(value) { result = value; },
        setUpdate(value) { update = value; },
        async disconnect() {
            connected = false;
            await act(async () => root.update(React.createElement(Root)));
        },
        async reconnect() {
            connected = true;
            await act(async () => root.update(React.createElement(Root)));
        },
    };
}

test('same Paseo base and product version still notifies for an older daemon build', async t => {
    const state = await fixture(t);
    const card = state.cards.get('paseodog-daemon-update:linux');
    assert.equal(card.title, '데몬 업데이트 사용 가능');
    assert.match(card.description, /Linux 호스트: 1\.0\.0-rc\.7\.11068 → 1\.0\.0-rc\.7\.11069/);
    assert.match(card.description, /이 앱을 업데이트해도 연결된 데몬은 업데이트되지 않습니다/);
    assert.match(card.description, /실행 중인 작업이 중지될 수 있습니다/);
    assert.deepEqual(state.calls, [['paseodog-provider', 'daemon-release', {}]]);
    assert.deepEqual(state.fetchURLs, ['https://api.github.com/repos/moveju112/paseodog/releases/latest']);
    assert.equal(card.actions.length, 1);
    card.actions[0].onPress();
    assert.deepEqual(state.opened, ['https://github.com/moveju112/paseodog/releases/latest']);
    assert.equal(state.calls.length, 1); // 안내를 열어도 원격 변경 RPC는 보내지 않는다.
});

for (const versionCode of [11069, 11070]) {
    test(`equal or newer daemon build ${versionCode} has no update warning`, async t => {
        const state = await fixture(t, { release: { version: '1.0.0-rc.7', versionCode } });
        assert.equal(state.cards.size, 0);
    });
}

for (const release of [new Error('Unknown plugin RPC'), {}, { version: '1.0.0-rc.7', versionCode: -1 }]) {
    test('old daemon, failed RPC or malformed metadata is unknown, not a confirmed update', async t => {
        const state = await fixture(t, { release });
        const card = state.cards.get('paseodog-daemon-update:linux');
        assert.equal(card.title, '데몬 업데이트 확인 필요');
        assert.match(card.description, /데몬 버전을 확인하지 못했습니다/);
    });
}

test('offline and non-PaseoDog hosts do not query daemon-release or notify', async t => {
    for (const options of [{ connected: false }, { provider: 'codex' }]) {
        const state = await fixture(t, options);
        assert.equal(state.calls.length, 0);
        assert.equal(state.cards.size, 0);
    }
});

test('release lookup failure never claims an update is available', async t => {
    const state = await fixture(t, { fetchError: new Error('network failed') });
    assert.equal(state.cards.size, 0);
});

for (const payload of [null, {}, { tag_name: 'v1.0.0-rc.7.11069', draft: true, prerelease: false },
    { tag_name: 'v1.0.0-rc.7.11069', draft: false, prerelease: true },
    { tag_name: 'v1.0.0-rc.7.9007199254740992', draft: false, prerelease: false }]) {
    test('invalid, unpublished or unsafe release metadata cannot trigger an update', async t => {
        const state = await fixture(t, { payload });
        assert.equal(state.cards.size, 0);
    });
}

test('host notifications are separate, share one release lookup and disappear when disconnected', async t => {
    const state = await fixture(t, { hosts: [
        { serverId: 'linux-a', label: 'Linux A' }, { serverId: 'linux-b', label: 'Linux B' },
    ] });
    assert.equal(state.fetches, 1);
    assert.equal(state.cards.size, 2);
    const a = state.cards.get('paseodog-daemon-update:linux-a');
    const b = state.cards.get('paseodog-daemon-update:linux-b');
    assert.notEqual(a.dismissalKey, b.dismissalKey);
    await state.disconnect();
    assert.equal(state.cards.size, 0);
    state.setRelease({ version: '1.0.0-rc.7', versionCode: 11069 });
    await state.reconnect();
    assert.equal(state.cards.size, 0);
});

test('periodic lookup updates dismissal identity when a newer release is published', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const state = await fixture(t);
    const before = state.cards.get('paseodog-daemon-update:linux').dismissalKey;
    state.setUpdate({ ...manifest, versionCode: 11070, versionName: '1.0.0-rc.7.11070' });
    await act(async () => t.mock.timers.tick(30 * 60 * 1000));
    assert.equal(state.fetches, 2);
    assert.notEqual(state.cards.get('paseodog-daemon-update:linux').dismissalKey, before);
});

test('late reply from a disconnected host cannot replace a fresh release result', async t => {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const state = await fixture(t, { release: pending });
    await state.disconnect();
    state.setRelease({ version: '1.0.0-rc.7', versionCode: 11069 });
    await state.reconnect();
    await act(async () => resolve({ version: '1.0.0-rc.7', versionCode: 11068 }));
    assert.equal(state.cards.size, 0);
});

test('daemon release RPC reports the loaded product release and rejects mutation inputs', () => {
    assert.equal(DAEMON_RELEASE.versionCode, 11069);
    assert.equal(DAEMON_RELEASE.version, '1.0.0-rc.7');
    assert.ok(Object.isFrozen(DAEMON_RELEASE));
    assert.equal(daemonRelease.name, 'daemon-release');
    assert.deepEqual(daemonRelease.output.parse(DAEMON_RELEASE), DAEMON_RELEASE);
    assert.throws(() => daemonRelease.input.parse({ restart: true }));
});

test('web patch preserves the app callout, shares source behavior and remains hash gated', () => {
    const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const patched = patchedComposerSource(installed), original = withoutDaemonUpdate(patched);
    new Script(patched);
    assert.equal(withDaemonUpdate(original), patched);
    assert.equal(patchedComposerSource(patched), patched);
    assert.ok(patched.includes(createDaemonUpdateCallouts.toString()));
    assert.ok(patched.includes('createElement(PaseodogOriginalUpdateCallout)'));
    // 패치된 실제 Metro 모듈을 실행해 기존 앱 알림과 데몬 알림이 함께 마운트되는지 확인한다.
    const position = patched.indexOf('e.UpdateCalloutSource=');
    const from = patched.lastIndexOf('\n__d(', position);
    const to = patched.indexOf('\n__d(', position);
    const text = patched.slice(from + '\n__d('.length, to);
    const tail = /\},(\d+),\[([\d,]*)\]\);\s*$/.exec(text);
    const factory = new Function(`return ${text.slice(0, tail.index + 1)}`)();
    const exports = {};
    factory(globalThis, id => id === 36 ? React : {}, null, null, { exports }, exports, tail[2].split(',').map(Number));
    const children = exports.UpdateCalloutSource().props.children;
    assert.equal(children.length, 2);
    assert.equal(children[1].type.name, 'DaemonUpdateCallouts');
    assert.throws(() => patchedComposerSource(original + '\n/* drift */'), /hash mismatch/);
    assert.throws(() => patchedComposerSource(patched.replace('/* paseodog-daemon-update:end */', '')), /Partial Paseo daemon update/);
});
