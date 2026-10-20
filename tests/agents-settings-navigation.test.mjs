import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { AGENTS_SETTINGS_AFTER, withAgentsSettings, withoutAgentsSettings } from '../patches/paseo-agents-settings.mjs';

const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');

// 실제 메뉴 배열을 평가해 네이티브·웹에서 같은 경로와 번역 키를 선택하는지 확인한다.
test('shared native and reviewed web menus expose the existing agents settings route', () => {
    const patched = patchedComposerSource(installed);
    new Script(patched);
    const start = patched.indexOf('const Ae=[') + 'const Ae='.length;
    const web = new Function('f', `return ${patched.slice(start, patched.indexOf('],Le=', start) + 1)}`)(
        new Proxy({}, { get: (_target, name) => name }),
    );
    const native = readFileSync(new URL('../android/packages/app/src/screens/settings-screen.tsx', import.meta.url), 'utf8');
    const nativeStart = native.indexOf('const HOST_SECTION_ITEMS: HostSectionItem[] = [') + 'const HOST_SECTION_ITEMS: HostSectionItem[] = '.length;
    const array = native.slice(nativeStart, native.indexOf('];', nativeStart) + 1);
    const icons = [...new Set([...array.matchAll(/icon: (\w+)/g)].map((match) => match[1]))];
    const shared = new Function(...icons, `return ${array}`)(...icons);
    for (const items of [web, shared]) {
        const entry = items.filter((item) => item.id === 'agents');
        assert.equal(entry.length, 1);
        assert.equal(entry[0].labelKey, 'settings.hostSections.agents');
        assert.equal(items.some((item) => item.id === 'engine-accounts'), true);
    }
    assert.equal(patchedComposerSource(patched), patched);
    assert.equal(withAgentsSettings(withoutAgentsSettings(patched)), patched);
    assert.throws(() => withoutAgentsSettings(patched + AGENTS_SETTINGS_AFTER), /drift/);
    assert.throws(() => withAgentsSettings(patched), /anchor mismatch/);
    const drifted = withoutAgentsSettings(patched).replace('const Ae=[', 'const Ae= [');
    assert.throws(() => patchedComposerSource(drifted), /hash mismatch/);
});
