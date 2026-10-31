import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { scratchRoot } from '../scripts/paths.mjs';
import { handleSpeechSettings } from '../plugin/server/speech-settings.mjs';
import { KOREAN_SPEECH_MODELS, GPU_SPEECH_MODEL, KOMIX_SPEECH_MODEL } from '../plugin/shared/speech-models.mjs';
import { installedComposerFixture } from './composer-fixture.mjs';
import { withSpeechSettings, withoutSpeechSettings } from '../patches/paseo-speech-settings.mjs';
import { withSettingsLayout, withoutSettingsLayout } from '../patches/paseo-settings-layout.mjs';

function fixture(t) {
    const home = mkdtempSync(join(scratchRoot, 'speech-settings-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const path = join(home, 'config.json');
    const config = {
        version: 1, agents: { providers: { paseodog: { enabled: true } } },
        daemon: { listen: '127.0.0.1:6767' },
        features: { dictation: { enabled: false }, voiceMode: { tts: { provider: 'local' } } },
        providers: { local: { modelsDir: '/models' } },
    };
    writeFileSync(path, JSON.stringify(config));
    return { path, config, env: { PASEO_HOME: home } };
}

test('speech settings preserve unrelated config and only save Korean local STT with revision checks', t => {
    const { path, config, env } = fixture(t);
    let snapshot = handleSpeechSettings({ action: 'read' }, env);
    assert.equal(snapshot.model, 'sense-voice-zh-en-ja-ko-yue-int8');
    assert.deepEqual(snapshot.models.map(model => model.id), [
        'sense-voice-zh-en-ja-ko-yue-int8', 'whisper-base-int8', 'whisper-small-int8', 'whisper-turbo-int8',
    ]);
    const stale = snapshot.revision;
    for (const model of snapshot.models) {
        snapshot = handleSpeechSettings({ action: 'write', model: model.id, revision: snapshot.revision }, env);
        const saved = JSON.parse(readFileSync(path, 'utf8'));
        for (const feature of ['dictation', 'voiceMode']) {
            assert.deepEqual(saved.features[feature].stt, { provider: 'local', model: model.id, language: 'ko' });
        }
        assert.equal(saved.features.dictation.enabled, false);
        assert.deepEqual(saved.features.voiceMode.tts, config.features.voiceMode.tts);
        assert.deepEqual(saved.providers, config.providers);
        assert.deepEqual(saved.agents, config.agents);
        assert.deepEqual(saved.daemon, config.daemon);
    }
    const before = readFileSync(path, 'utf8');
    for (const model of ['whisper-small.en', 'gpt-4o-transcribe', 'parakeet-tdt-0.6b-v3-int8', '../outside']) {
        assert.throws(() => handleSpeechSettings({ action: 'write', model, revision: snapshot.revision }, env), /Unsupported/);
    }
    assert.throws(() => handleSpeechSettings({ action: 'write', model: snapshot.model, revision: stale }, env), /changed/);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.match(snapshot.models.at(-1).warning, /CPU 실행.*GPU를 자동 사용하지/);
});

test('speech settings reject non-dedicated homes, symlinks, environment overrides and malformed config', t => {
    const { path, config, env } = fixture(t);
    assert.throws(() => handleSpeechSettings({ action: 'read' }, {}), /Dedicated/);
    const override = { ...env, PASEO_DICTATION_STT_PROVIDER: 'openai' };
    const snapshot = handleSpeechSettings({ action: 'read' }, override);
    assert.equal(snapshot.blocked, true);
    assert.throws(() => handleSpeechSettings({ action: 'write', model: snapshot.model, revision: snapshot.revision }, override), /environment/);
    writeFileSync(path, '{"secret": "not-valid-json"');
    assert.throws(() => handleSpeechSettings({ action: 'read' }, env), /^Error: Invalid daemon configuration$/);
    writeFileSync(path, JSON.stringify({ ...config, agents: {} }));
    assert.throws(() => handleSpeechSettings({ action: 'read' }, env), /Dedicated/);
    rmSync(path);
    symlinkSync('missing', path);
    assert.throws(() => handleSpeechSettings({ action: 'read' }, env), /Regular/);
});

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const source = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/speech-settings.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const bundle = installedComposerFixture();
const start = bundle.indexOf('const PaseodogSpeechSettings=');
const web = bundle.slice(start, bundle.indexOf('const PaseodogAgentMessageSettings=', start));

test('speech web patch reverses, rejects partial patches and retains its source hash gate', () => {
    assert.equal(withSettingsLayout(withSpeechSettings(withoutSpeechSettings(withoutSettingsLayout(bundle)))), bundle);
    assert.throws(() => withoutSpeechSettings(withoutSettingsLayout(bundle).replace(web, '')), /Partial/);
    assert.throws(() => withSpeechSettings(''), /anchor mismatch/);
});

for (const platform of ['app', 'web']) {
    test(`${platform}: Korean candidates save without replay; warnings support hover, focus and touch`, async t => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        let connected = true, fail = false, delayed, finish;
        const calls = [];
        const values = { one: KOREAN_SPEECH_MODELS[0].id, two: KOREAN_SPEECH_MODELS[1].id };
        const snapshot = host => ({ model: values[host], revision: 'a'.repeat(64), blocked: false,
            models: [...KOREAN_SPEECH_MODELS, GPU_SPEECH_MODEL, KOMIX_SPEECH_MODEL] });
        const clients = Object.fromEntries(Object.keys(values).map(host => [host, {
            async invokePluginRpc(plugin, method, request) {
                assert.equal(plugin, 'paseodog-provider');
                assert.equal(method, 'speech-settings');
                calls.push({ host, ...request });
                if (delayed === host) return new Promise(resolve => { finish = resolve; });
                if (fail) throw new Error('uncertain result');
                if (request.action === 'write') {
                    assert.equal(request.revision, 'a'.repeat(64));
                    values[host] = request.model;
                }
                return snapshot(host);
            },
        }]));
        const runtime = { useHostRuntimeClient: id => clients[id], useHostRuntimeIsConnected: () => connected };
        const components = { View: 'view', Text: 'text', Pressable: 'pressable', SelectField: 'select-field' };
        const Component = platform === 'app'
            ? runInNewContext(source + ';SpeechSettings', { ...React, ...components, ...runtime, settingsStyles: {} })
            : runInNewContext(web + ';PaseodogSpeechSettings', {
                u: React, n: components, o: components, r: components, S: { settingsStyles: {} },
                _r: id => {
                    if (id === 4659) return components;
                    assert.equal(id, 3762);
                    return runtime;
                },
            });
        let tree;
        await act(async () => { tree = create(React.createElement(Component, { serverId: 'one' })); });
        t.after(async () => {
            await act(async () => tree.unmount());
            delete globalThis.IS_REACT_ACT_ENVIRONMENT;
        });
        const radio = label => tree.root.findByProps({ accessibilityLabel: label });
        const selector = () => tree.root.findByType('select-field');
        const select = async id => act(async () => selector().props.onChange(id));
        const refresh = () => radio('음성인식 설정 새로고침');
        const warning = () => radio('Whisper Large-v3 Turbo 연산 경고');
        const warnings = () => tree.root.findAll(node => node.type === 'text' && node.props.children === KOREAN_SPEECH_MODELS[3].warning);
        assert.equal(tree.root.findAll(node => node.type === 'pressable' && node.props.accessibilityRole === 'radio').length, 0);
        assert.equal(tree.root.findAllByType('select-field').length, 1);
        assert.equal(selector().props.options.length, 6);
        assert.equal(selector().props.value, values.one);
        assert.match(selector().props.options.at(-1).description, /GPU/);
        const initialCalls = calls.length;
        await select(values.one);
        assert.equal(calls.length, initialCalls);
        await select(KOREAN_SPEECH_MODELS[3].id);
        assert.equal(warnings().length, 0);
        for (const [open, close] of [['onHoverIn', 'onHoverOut'], ['onFocus', 'onBlur'], ['onPress', 'onPress']]) {
            await act(async () => warning().props[open]());
            assert.equal(warnings().length, 1);
            await act(async () => warning().props[close]());
            assert.equal(warnings().length, 0);
        }
        await select(GPU_SPEECH_MODEL.id);
        const gpuWarning = radio(`${GPU_SPEECH_MODEL.label} 연산 경고`);
        await act(async () => gpuWarning.props.onHoverIn());
        assert.match(JSON.stringify(tree.toJSON()), /GPU 메모리·전력/);
        assert.equal(values.one, 'whisper-turbo-cuda');
        await select(KOMIX_SPEECH_MODEL.id);
        assert.equal(values.one, 'whisper-medium-komix-v2-cuda');
        await select('whisper-small-int8');
        assert.equal(values.one, 'whisper-small-int8');
        assert.match(JSON.stringify(tree.toJSON()), /재시작한 뒤 적용/);
        fail = true;
        await select('whisper-base-int8');
        const count = calls.length;
        assert.match(JSON.stringify(tree.toJSON()), /자동 재전송하지/);
        assert.equal(calls.length, count);
        fail = false;
        delayed = 'one';
        await act(async () => refresh().props.onPress());
        await act(async () => tree.update(React.createElement(Component, { serverId: 'two' })));
        assert.equal(selector().props.value, 'whisper-base-int8');
        await act(async () => finish(snapshot('one')));
        assert.equal(selector().props.value, 'whisper-base-int8');
        connected = false;
        await act(async () => tree.update(React.createElement(Component, { serverId: 'two' })));
        assert.equal(refresh().props.disabled, true);
        connected = true;
        await act(async () => tree.update(React.createElement(Component, { serverId: 'two' })));
        assert.equal(selector().props.value, 'whisper-base-int8');
    });
}
