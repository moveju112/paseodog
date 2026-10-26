import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { normalizeAssistantPhoto, assistantPhotoCrop } from '../android/packages/app/src/hooks/use-settings/assistant-photo.ts';
import { createAssistantProfileSettings } from '../android/packages/app/src/screens/settings/chat/assistant-profile-settings.ts';
import { ASSISTANT_ICONS } from '../android/packages/app/src/hooks/use-settings/assistant-icons.ts';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';

const photo = 'data:image/jpeg;base64,/9j/2Q==';
const req = createRequire(new URL('../plugin/package.json', import.meta.url));
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');

test('profile photos are bounded local JPEGs and use a centered square crop', () => {
    assert.equal(normalizeAssistantPhoto(photo), photo);
    for (const value of [null, undefined, {}, [], 1, 'file:///private.jpg', 'https://example.com/avatar',
        'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA',
        'data:image/jpeg;base64,/9j/!', photo + 'A'.repeat(128 * 1024)])
        assert.equal(normalizeAssistantPhoto(value), '');
    assert.deepEqual(assistantPhotoCrop(640, 480), { originX: 80, originY: 0, width: 480, height: 480 });
    assert.deepEqual(assistantPhotoCrop(480, 640), { originX: 0, originY: 80, width: 480, height: 480 });
    for (const size of [0, -1, NaN, Infinity]) assert.throws(() => assistantPhotoCrop(size, 10), /dimensions/);
});

test('native profile selection is single-file, converts to JPEG and releases image resources', async () => {
    const source = readFileSync(new URL('../android/packages/app/src/hooks/assistant-photo-picker.native.ts', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    let canceled = false, oversized = false, failure = false, renders = 0;
    const calls = [];
    const context = {
        crop: (value) => calls.push(['crop', { ...value }]),
        resize: (value) => calls.push(['resize', { ...value }]),
        renderAsync: async () => (++renders % 2 === 1 ? {
            width: 640, height: 480, release: () => calls.push(['original-release']),
        } : {
            saveAsync: async (options) => {
                calls.push(['save', { ...options }]);
                if (failure) throw new Error('conversion failed');
                return { base64: '/9j/2Q==' };
            },
            release: () => calls.push(['thumbnail-release']),
        }),
        release: () => calls.push(['context-release']),
    };
    const modules = {
        'expo-document-picker': { getDocumentAsync: async (options) => {
            calls.push(['pick', options.multiple, options.copyToCacheDirectory]);
            return canceled ? { canceled: true } : { canceled: false, assets: [{ uri: 'file:///fixture.jpg' }] };
        } },
        'expo-file-system': { File: class { size = oversized ? 21 * 1024 * 1024 : 100; } },
        'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: {
            manipulate: () => { calls.push(['manipulate']); return context; },
        } },
        './use-settings/assistant-photo': { normalizeAssistantPhoto, assistantPhotoCrop },
    };
    const exported = {};
    runInNewContext(code, { exports: exported, require: (name) => modules[name] });
    assert.equal(await exported.pickAssistantPhoto(), photo);
    assert.deepEqual(calls, [
        ['pick', false, true], ['manipulate'],
        ['crop', { originX: 80, originY: 0, width: 480, height: 480 }],
        ['resize', { width: 256, height: 256 }],
        ['save', { format: 'jpeg', compress: 0.8, base64: true }],
        ['thumbnail-release'], ['original-release'], ['context-release'],
    ]);
    calls.length = 0;
    canceled = true;
    assert.equal(await exported.pickAssistantPhoto(), null);
    assert.deepEqual(calls, [['pick', false, true]]);
    canceled = false;
    oversized = true;
    calls.length = 0;
    await assert.rejects(exported.pickAssistantPhoto(), /20 MiB/);
    assert.deepEqual(calls, [['pick', false, true]]);
    oversized = false;
    failure = true;
    calls.length = 0;
    await assert.rejects(exported.pickAssistantPhoto(), /conversion failed/);
    assert.deepEqual(calls.slice(-3), [['thumbnail-release'], ['original-release'], ['context-release']]);
});

test('profile controls ignore stale picker results and report save failure without replacing the photo', async (t) => {
    const React = req('react');
    const { create, act } = req('react-test-renderer');
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    t.after(() => { delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
    let settings = { assistantNickname: 'Dog', assistantIcon: '🐶', assistantPhoto: photo };
    let resolvePick, fail = false, pickCount = 0;
    const updates = [];
    const Profile = createAssistantProfileSettings({
        React, View: 'View', Image: 'Image', SettingsSelect: 'Select', SettingsAction: 'Action', SettingsRow: 'Row',
        icons: ASSISTANT_ICONS,
        useTranslation: () => ({ t: (key) => key, i18n: { language: 'ko' } }),
        useAppSettings: () => ({ settings, updateSettings: async (value) => {
            if (fail) throw new Error('storage full');
            updates.push(value); settings = { ...settings, ...value };
        } }),
        pickPhoto: () => { pickCount++; return new Promise((done) => { resolvePick = done; }); },
    });
    let tree;
    await act(async () => { tree = create(React.createElement(Profile)); });
    const action = (id) => tree.root.find((node) => node.type === 'Action' && node.props.testID === id);
    await act(async () => {
        action('assistant-photo-pick').props.onPress();
        action('assistant-photo-pick').props.onPress();
    });
    assert.equal(pickCount, 1);
    await act(async () => tree.root.findByType('Select').props.onValueChange('🤖'));
    await act(async () => resolvePick(photo));
    assert.equal(settings.assistantIcon, '🤖');
    assert.equal(settings.assistantPhoto, '');
    assert.equal(updates.length, 1);
    fail = true;
    await act(async () => action('assistant-photo-pick').props.onPress());
    await act(async () => resolvePick(photo));
    assert.equal(settings.assistantPhoto, '');
    assert.ok(action('assistant-photo-pick').props.error);
    fail = false;
    await act(async () => action('assistant-photo-pick').props.onPress());
    await act(async () => tree.unmount());
    await act(async () => resolvePick(photo));
    assert.equal(updates.length, 1);
});

test('reviewed web settings validate photos and reject partial photo patches', () => {
    const source = composerFixture(readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8'));
    const expression = /assistantPhoto:(f\.z\.string\(\)\.transform\([\s\S]*?\)\.catch\(""\)),/.exec(source);
    assert.ok(expression);
    const schema = runInNewContext(expression[1], { f: { z: req('zod').z } });
    assert.equal(schema.parse(photo), photo);
    for (const value of [undefined, null, 'https://example.com/photo', 'data:image/svg+xml;base64,PHN2Zz4='])
        assert.equal(schema.parse(value), '');
    const partial = source.replace('assistantPhoto:"",toolCallDetailLevel:', 'toolCallDetailLevel:');
    assert.notEqual(partial, source);
    assert.throws(() => patchedComposerSource(partial), /Partial Paseo assistant photo/);
});
