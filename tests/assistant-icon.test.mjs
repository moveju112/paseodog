import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { ASSISTANT_ICONS } from '../android/packages/app/src/hooks/use-settings/assistant-icons.ts';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { ASSISTANT_ICON_EDITS, withAssistantIcon, withoutAssistantIcon } from '../patches/paseo-assistant-icon.mjs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const patched = patchedComposerSource(read('tools/node_modules/@getpaseo/server/' + COMPOSER_FILE));
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');

// 공유 화면과 실제 웹 Metro 모듈에 같은 설정 저장 대역을 주입한다.
function chatSections(stub) {
    const native = { exports: {} };
    const code = ts.transpileModule(read('android/packages/app/src/screens/settings/chat/chat-section.tsx'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'element' },
    }).outputText;
    const element = (type, props, ...children) => ({
        type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
    });
    runInNewContext(code, { exports: native.exports, require: () => stub, element });
    const position = patched.indexOf('e.ChatSection=function');
    const start = patched.lastIndexOf('\n__d(', position);
    const end = patched.indexOf('\n__d(', position);
    const text = patched.slice(start + '\n__d('.length, end);
    const tail = /\},(\d+),\[([\d,]*)\]\);\s*$/.exec(text);
    assert.ok(tail);
    const factory = runInNewContext('(' + text.slice(0, tail.index + 1) + ')');
    const web = { exports: {} };
    factory(globalThis, () => stub, null, null, web, web.exports, tail[2].split(',').map(Number));
    return [native.exports.ChatSection, web.exports.ChatSection];
}

test('shared and web put the icon next to the nickname and save it independently', () => {
    let settings = { assistantNickname: 'Mixy', assistantIcon: '', toolCallDetailLevel: 'detailed' };
    const updates = [];
    const cache = [];
    const stub = {
        ASSISTANT_ICONS, useMemo: (make) => make(), useCallback: (callback) => callback,
        useTranslation: () => ({ t: (key) => key }),
        useAppSettings: () => ({ settings, updateSettings: (update) => {
            updates.push(update);
            settings = { ...settings, ...update };
        } }),
        c: (size) => {
            if (!cache.length) cache.push(...Array(size).fill(Symbol.for('react.memo_cache_sentinel')));
            return cache;
        },
        jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }),
        View: 'View', SettingsCard: 'SettingsCard', SettingsInput: 'SettingsInput',
        SettingsSection: 'SettingsSection', SettingsSelect: 'SettingsSelect',
        SettingsSwitch: 'SettingsSwitch', isNative: false,
    };
    for (const ChatSection of chatSections(stub)) {
        const rows = () => ChatSection().props.children.props.children.props.children;
        const picker = () => rows().find((row) => row?.props.testID === 'assistant-icon-select');
        const items = rows();
        const nicknameIndex = items.findIndex((row) => row?.props.testID === 'assistant-nickname-input');
        assert.equal(items[nicknameIndex + 1].props.testID, 'assistant-icon-select');
        assert.deepEqual(Array.from(picker().props.options, (option) => option.value), [...ASSISTANT_ICONS]);
        assert.equal(picker().props.options[0].label, 'settings.general.assistantIcon.initial');
        for (const icon of ['🐶', '🐱', '🤖', '✨', '🐾', '']) {
            picker().props.onValueChange(icon);
            assert.deepEqual({ ...updates.at(-1) }, { assistantIcon: icon });
            assert.equal(picker().props.value, icon);
            assert.equal(settings.assistantNickname, 'Mixy');
        }
    }
});

test('web icon validation, localized labels and patch reversal match shared settings', () => {
    const z = createRequire(new URL('../plugin/package.json', import.meta.url))('zod').z;
    const schema = /assistantIcon:(f\.z\.enum\(\[[^\]]+\]\)\.catch\(""\)),/.exec(patched);
    assert.ok(schema);
    const iconSchema = runInNewContext(schema[1], { f: { z } });
    for (const icon of ASSISTANT_ICONS) assert.equal(iconSchema.parse(icon), icon);
    for (const invalid of [undefined, null, 'unknown', 7, {}, ['🐶']]) assert.equal(iconSchema.parse(invalid), '');
    for (const locale of ['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN']) {
        const source = read(`android/packages/app/src/i18n/resources/${locale}.ts`);
        const copy = /assistantIcon: \{([\s\S]*?)\n\s*\}/.exec(source);
        assert.ok(copy);
        const values = Object.fromEntries([...copy[1].matchAll(/(label|description|initial): "([^"]+)"/g)].map((match) => [match[1], match[2]]));
        assert.ok(patched.includes('assistantIcon:' + JSON.stringify(values)));
    }
    assert.equal(withAssistantIcon(withoutAssistantIcon(patched)), patched);
    const [before, after] = ASSISTANT_ICON_EDITS[0];
    const partial = patched.replace(after, before);
    assert.notEqual(partial, patched);
    assert.throws(() => patchedComposerSource(partial), /Partial Paseo assistant icon/);
    assert.equal(patchedComposerSource(patched), patched);
    assert.throws(() => patchedComposerSource(patched + '// drift'), /hash mismatch/);
});
