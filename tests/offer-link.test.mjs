import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OFFER_LINK_BEFORE, OFFER_LINK_AFTER, withOfferLink, withoutOfferLink } from '../patches/paseo-offer-link.mjs';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const { build } = require('esbuild');

// 실제 공유 앱 리스너를 메모리에서 번들링하고 호스트·링크·입력창 경계만 테스트 대역으로 교체한다.
async function sharedListener(dependencies) {
    const result = await build({
        entryPoints: [fileURLToPath(new URL('../android/packages/app/src/hosts/offer-link-listener.tsx', import.meta.url))],
        bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'transform',
        plugins: [{
            name: 'listener-host',
            setup(builder) {
                builder.onResolve({ filter: /^(react|expo-linking|expo-router|@\/.*)$/ },
                    ({ path }) => ({ path, external: true }));
            },
        }],
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'React', result.outputFiles[0].text)(
        (id) => dependencies[id], module, module.exports, React);
    return module.exports.OfferLinkListener;
}

// 고정 번들의 리스너도 같은 대역에서 실제 React 훅으로 실행한다.
function webListener(dependencies) {
    return new Function('h', 'f', 'u', 'We', 'Be', 'Ue', 'r', `${OFFER_LINK_AFTER};return Pt`)(
        dependencies['expo-router'], React, dependencies['expo-linking'],
        dependencies['@/runtime/host-runtime'], dependencies['@/utils/host-routes'],
        { jsx: React.createElement }, (id) => {
            assert.equal(id, 5268);
            return dependencies['@/components/pair-link-modal'];
        });
}

for (const [platform, factory] of [['shared', sharedListener], ['web', webListener]]) {
    test(`${platform}: link opens password form before connecting; cancel and success are explicit`, async (t) => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        let listener;
        let pendingProps;
        let removed = false;
        let initialResolve;
        const navigations = [];
        const pairing = { submit: () => { throw new Error('No implicit connection allowed'); } };
        const dependencies = {
            react: React,
            'expo-router': { useRouter: () => ({ replace: (route) => navigations.push(route) }) },
            'expo-linking': {
                getInitialURL: () => new Promise((resolve) => { initialResolve = resolve; }),
                addEventListener: (event, callback) => {
                    assert.equal(event, 'url'); listener = callback;
                    return { remove: () => { removed = true; } };
                },
            },
            '@/runtime/host-runtime': {
                getHostRuntimeStore: () => ({ beginLinkPairing: () => pairing }),
            },
            '@/utils/host-routes': { buildOpenProjectRoute: () => '/open-project' },
            '@/components/pair-link-modal': {
                PairLinkModal: (props) => { pendingProps = props; return React.createElement('form'); },
            },
        };
        const Component = await factory(dependencies);
        let tree;
        t.after(async () => {
            await act(async () => tree?.unmount());
            delete globalThis.IS_REACT_ACT_ENVIRONMENT;
        });
        await act(async () => { tree = create(React.createElement(Component)); });
        assert.equal(tree.toJSON(), null);
        await act(async () => initialResolve('https://host/#offer=test'));
        assert.equal(pendingProps.visible, true);
        assert.equal(pendingProps.passwordRequired.link, 'https://host/#offer=test');
        assert.equal(pendingProps.passwordRequired.pairing, pairing);
        assert.deepEqual(navigations, []);
        await act(async () => pendingProps.onClose());
        assert.equal(tree.toJSON(), null);
        for (const link of ['https://host/#connect=test', 'relay://test']) {
            await act(async () => listener({ url: link }));
            assert.equal(pendingProps.passwordRequired.link, link);
            await act(async () => pendingProps.onSaved());
            assert.equal(tree.toJSON(), null);
        }
        assert.deepEqual(navigations, ['/open-project', '/open-project']);
        await act(async () => listener({ url: 'https://unrelated/' }));
        assert.equal(tree.toJSON(), null);
        await act(async () => tree.unmount());
        assert.equal(removed, true);
        pendingProps = null;
        await act(async () => listener({ url: 'relay://late' }));
        assert.equal(pendingProps, null);
    });
}

test('web listener patch is hash-gated, reversible and idempotent in the composer chain', () => {
    const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    // 하드코딩한 모듈 식별자가 실제 PairLinkModal 모듈인지 검토된 번들에서 확인한다.
    const modalStart = installed.indexOf('_e.PairLinkModal=function');
    const modalEnd = installed.indexOf('\n__d(', modalStart);
    assert.match(installed.slice(modalStart, modalEnd), /\},5268,\[/);
    const patched = composerFixture(installed);
    assert.ok(patched.includes(OFFER_LINK_AFTER));
    assert.equal(composerFixture(patched), patched);
    assert.equal(withoutOfferLink(withOfferLink(OFFER_LINK_BEFORE)), OFFER_LINK_BEFORE);
    assert.throws(() => withOfferLink(OFFER_LINK_AFTER), /anchor mismatch/);
    assert.throws(() => patchedComposerSource(installed + '// drift'), /hash mismatch/);
});
