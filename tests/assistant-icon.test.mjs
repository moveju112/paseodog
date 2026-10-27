import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { ASSISTANT_ICONS } from '../android/packages/app/src/hooks/use-settings/assistant-icons.ts';
import { createAssistantProfileSettings } from '../android/packages/app/src/screens/settings/chat/assistant-profile-settings.ts';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');

// 앱과 서버 웹이 함께 빌드하는 화면에 설정 저장 대역을 주입한다.
function chatSections(stub) {
    const native = { exports: {} };
    const code = ts.transpileModule(read('android/packages/app/src/screens/settings/chat/chat-section.tsx'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'element' },
    }).outputText;
    const element = (type, props, ...children) => ({
        type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
    });
    runInNewContext(code, { exports: native.exports, require: () => stub, element });
    return [native.exports.ChatSection];
}

test('shared and web place profile controls next to the nickname and persist icons and photos', async (t) => {
    const req = createRequire(new URL('../plugin/package.json', import.meta.url));
    const React = req('react');
    const { create, act } = req('react-test-renderer');
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    t.after(() => { delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
    const photo = 'data:image/jpeg;base64,/9j/2Q==';
    let cancel = false;
    let settings = { assistantNickname: 'Mixy', assistantIcon: '', assistantPhoto: '', toolCallDetailLevel: 'detailed' };
    const updates = [];
    const cache = [];
    const stub = {
        ...React,
        ASSISTANT_ICONS, useMemo: (make) => make(), useCallback: (callback) => callback,
        useTranslation: () => ({ t: (key) => key, i18n: { language: 'ko' } }),
        useAppSettings: () => ({ settings, updateSettings: async (update) => {
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
        SettingsSwitch: 'SettingsSwitch', SettingsAction: 'SettingsAction', SettingsRow: 'SettingsRow',
        Image: 'Image', isNative: false,
    };
    stub.AssistantProfileSettings = createAssistantProfileSettings({
        ...stub, React, icons: ASSISTANT_ICONS, pickPhoto: async () => cancel ? null : photo,
    });
    const environment = {
        Image: class { naturalWidth = 640; naturalHeight = 480; async decode() {} },
        URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
        document: {
            body: { appendChild() {} },
            createElement: (type) => {
                if (type === 'canvas') return { getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => photo };
                const events = {};
                return { files: [{ size: 10, type: 'image/jpeg' }], remove() {},
                    addEventListener: (name, callback) => { events[name] = callback; },
                    click: () => events[cancel ? 'cancel' : 'change']() };
            },
        },
    };
    for (const ChatSection of chatSections(stub, environment)) {
        const rows = () => ChatSection().props.children.props.children.props.children;
        const items = rows();
        const nicknameIndex = items.findIndex((row) => row?.props.testID === 'assistant-nickname-input');
        assert.equal(items[nicknameIndex + 1].props.testID, 'assistant-profile-settings');
        const Profile = items[nicknameIndex + 1].type;
        let tree;
        await act(async () => { tree = create(React.createElement(Profile)); });
        const picker = () => tree.root.findByType('SettingsSelect');
        assert.deepEqual(Array.from(picker().props.options, (option) => option.value), [...ASSISTANT_ICONS]);
        assert.equal(picker().props.options[0].label, 'settings.general.assistantIcon.initial');
        for (const icon of ['🐶', '🐱', '🤖', '✨', '🐾', '']) {
            await act(async () => { picker().props.onValueChange(icon); });
            await act(async () => tree.update(React.createElement(Profile)));
            assert.deepEqual({ ...updates.at(-1) }, { assistantIcon: icon, assistantPhoto: '' });
            assert.equal(picker().props.value, icon);
            assert.equal(settings.assistantNickname, 'Mixy');
        }
        const action = (id) => tree.root.find((node) => node.type === 'SettingsAction' && node.props.testID === id);
        await act(async () => {
            action('assistant-photo-pick').props.onPress();
            await new Promise(setImmediate);
        });
        assert.equal(settings.assistantPhoto, photo);
        await act(async () => tree.update(React.createElement(Profile)));
        assert.equal(tree.root.findByType('Image').props.source.uri, photo);
        const count = updates.length;
        cancel = true;
        await act(async () => {
            action('assistant-photo-pick').props.onPress();
            await new Promise(setImmediate);
        });
        assert.equal(updates.length, count);
        assert.equal(settings.assistantPhoto, photo);
        cancel = false;
        await act(async () => { action('assistant-photo-remove').props.onPress(); });
        await act(async () => tree.update(React.createElement(Profile)));
        assert.equal(settings.assistantPhoto, '');
        assert.equal(settings.assistantNickname, 'Mixy');
        await act(async () => tree.unmount());
    }
});

test('shared icon validation and all localized labels remain available', () => {
    const z = createRequire(new URL('../plugin/package.json', import.meta.url))('zod').z;
    const schema = /assistantIcon: (z\.enum\(ASSISTANT_ICONS\)\.catch\(""\)),/.exec(
        read('android/packages/app/src/hooks/use-settings/storage.ts'));
    assert.ok(schema);
    const iconSchema = runInNewContext(schema[1], { z, ASSISTANT_ICONS });
    for (const icon of ASSISTANT_ICONS) assert.equal(iconSchema.parse(icon), icon);
    for (const invalid of [undefined, null, 'unknown', 7, {}, ['🐶']]) assert.equal(iconSchema.parse(invalid), '');
    for (const locale of ['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN']) {
        const source = read(`android/packages/app/src/i18n/resources/${locale}.ts`);
        const copy = /assistantIcon: \{([\s\S]*?)\n\s*\}/.exec(source);
        assert.ok(copy);
        const values = Object.fromEntries([...copy[1].matchAll(/(label|description|initial): "([^"]+)"/g)].map((match) => [match[1], match[2]]));
        assert.deepEqual(Object.keys(values).sort(), ['description', 'initial', 'label']);
        assert.ok(Object.values(values).every(value => value.trim().length > 0));
    }
});
