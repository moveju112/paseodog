import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import {
    TOOLBAR_ITEM, TOOLBAR_ITEMS, ROWS_FILTER, TOOLBAR_RENDER, withoutSidebarToolbar,
} from '../patches/paseo-sidebar-toolbar.mjs';

const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const patched = composerFixture(installed);
import { composerFixture } from './composer-fixture.mjs';

// 검토 번들 사이드바 모듈 범위의 대역으로 주입 함수를 실행해 PaseoDog 항목만 고른다.
function loadToolbarItems(items) {
    const jsx = (type, props, key) => ({ type, props, key });
    const factory = new Function('L', 'h', 'oe', 't', 'N',
        `${TOOLBAR_ITEM}${TOOLBAR_ITEMS}return{paseodogToolbarItem,PaseodogToolbarItems}`);
    return factory({ useSidebarNavItems: (section) => ({ items: section === 'footer' ? items : [] }) },
        { useRef: (value) => ({ current: value }) }, { jsx }, { View: 'view' }, { PluginSidebarItem: 'plugin-item' });
}

test('PaseoDog footer item moves from the quota rows into the bottom-left toolbar', () => {
    assert.equal(composerFixture(patched), patched);
    new Script(patched);
    assert.ok(patched.includes(ROWS_FILTER) && patched.includes(TOOLBAR_RENDER));
    assert.throws(() => patchedComposerSource(patched.replace(TOOLBAR_RENDER, '')), /Partial Paseo sidebar toolbar/);
    const own = { kind: 'plugin', visible: true, key: 'own', group: { pluginId: 'paseodog-provider' } };
    const other = { kind: 'plugin', visible: true, key: 'other', group: { pluginId: 'other-plugin' } };
    const hidden = { ...own, key: 'hidden', visible: false };
    const usage = { kind: 'usage', visible: true, key: 'usage' };
    const { paseodogToolbarItem, PaseodogToolbarItems } = loadToolbarItems([usage, other, own, hidden]);
    assert.deepEqual([usage, other, own].map(paseodogToolbarItem), [false, false, true]);
    const onBeforeNavigate = () => {};
    const row = PaseodogToolbarItems({ onBeforeNavigate });
    assert.equal(row.type, 'view');
    assert.deepEqual(row.props.children.map((item) => [item.type, item.key, item.props.section, item.props.group]),
        [['plugin-item', 'own', 'footer', own.group]]);
    assert.equal(row.props.children[0].props.onBeforeNavigate, onBeforeNavigate);
    assert.equal(loadToolbarItems([usage, other]).PaseodogToolbarItems({}), null);
    assert.equal(withoutSidebarToolbar(withoutSidebarToolbar(patched)).includes('PaseodogToolbarItems'), false);
});
