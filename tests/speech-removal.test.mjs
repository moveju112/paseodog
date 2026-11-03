import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { installedComposerFixture } from './composer-fixture.mjs';
import { patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { SPEECH_REMOVAL_EDITS, withSpeechRemoval, withoutSpeechRemoval } from '../patches/paseo-speech-removal.mjs';
import { withoutLegacySpeechSettings } from '../patches/paseo-settings-organization.mjs';
import { resolveComposerInputMode } from '../android/packages/app/src/composer/input-mode.ts';
import { configure } from '../scripts/configure.mjs';
import { runtimeEnv, scratchRoot } from '../scripts/paths.mjs';
import { resolveSpeechConfig } from '../tools/node_modules/@getpaseo/server/dist/server/server/speech/speech-config-resolver.js';

const bundle = installedComposerFixture();
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const webModule = anchor => {
    const modules = bundle.split('\n__d(').filter(part => part.includes(anchor));
    assert.equal(modules.length, 1, anchor);
    return modules[0];
};
const speechKinds = /kind: ?"(voice-toggle|dictation-toggle|voice-mute-toggle)"/g;

test('web speech removal is reversible, hash-gated and rejects partial patches', () => {
    new Script(bundle);
    const original = withoutSpeechRemoval(bundle);
    assert.notEqual(original, bundle);
    assert.equal(withSpeechRemoval(original), bundle);
    assert.equal(withoutSpeechRemoval(original), original);
    assert.equal(patchedComposerSource(original), bundle);
    assert.throws(() => withSpeechRemoval(bundle), /anchor mismatch/);
    const [before, after] = SPEECH_REMOVAL_EDITS[0];
    assert.throws(() => withoutSpeechRemoval(bundle.replace(after, () => before)), /Partial/);
    assert.throws(() => patchedComposerSource(original.replace(before, () => after)), /Partial/);
});

// 앱 소스와 웹 번들 모두 마이크 버튼을 렌더하지 않고 음성 단축키도 등록하지 않는다.
test('app and web hide the dictation button and register no speech shortcuts', () => {
    const exports = {};
    runInNewContext('__d(' + webModule('e.resolveComposerInputMode=function'), {
        __d: factory => factory({}, () => ({}), undefined, undefined, { exports }, exports, []),
    });
    for (const resolve of [resolveComposerInputMode, exports.resolveComposerInputMode]) {
        assert.equal(resolve('chat').showVoice, false);
        assert.equal(resolve('terminal').showVoice, false);
        assert.equal(resolve('chat').showAttachments, true);
    }
    const app = read('android/packages/app/src/keyboard/keyboard-shortcuts.ts');
    const bindings = webModule('message-input-dictation-confirm-enter');
    assert.deepEqual([...app.matchAll(speechKinds)], []);
    assert.deepEqual([...bindings.matchAll(speechKinds)], []);
    assert.match(app, /"agent-input": \["focus-message-input", "cycle-agent-mode", "agent-interrupt"\]/);
    assert.match(bindings, /"agent-input":\["focus-message-input","cycle-agent-mode","agent-interrupt"\]/);
    for (const surface of [app, bindings]) assert.match(surface, /message-input-dictation-confirm-enter/);
});

test('previous speech settings are removed only when complete and reviewed', () => {
    const row = 'e.section==="workflow"?u.createElement(PaseodogSpeechSettings,{key:"speech:"+e.serverId,serverId:e.serverId}):null,';
    const component = 'const PaseodogSpeechSettings=(()=>{changed;return SpeechSettings})();';
    assert.equal(withoutLegacySpeechSettings('unrelated'), 'unrelated');
    assert.throws(() => withoutLegacySpeechSettings(`a${row}b`), /Partial/);
    assert.throws(() => withoutLegacySpeechSettings(`${component}a`), /Partial/);
    assert.throws(() => withoutLegacySpeechSettings(`${component}a${row}b`), /hash mismatch/);
    for (const text of ['PaseodogSpeechSettings', 'speech-settings', 'engine-speech', 'engineSpeech'])
        assert.equal(bundle.includes(text), false, text);
});

test('daemon launches and saved configuration keep dictation and voice mode disabled', t => {
    const env = runtimeEnv();
    assert.equal(env.PASEO_DICTATION_ENABLED, 'false');
    assert.equal(env.PASEO_VOICE_MODE_ENABLED, 'false');
    const enabled = { features: {
        dictation: { enabled: true, stt: { provider: 'local', model: 'whisper-turbo-cuda', language: 'ko' } },
        voiceMode: { enabled: true, stt: { provider: 'local', model: 'whisper-small-int8' } },
    } };
    const resolved = resolveSpeechConfig({ paseoHome: '/paseo', env, persisted: enabled });
    for (const provider of Object.values(resolved.speech.providers)) assert.equal(provider.enabled, false);
    assert.equal(resolved.speech.local, undefined);

    const root = mkdtempSync(join(scratchRoot, 'speech-removal-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const home = join(root, 'paseo');
    mkdirSync(home, { mode: 0o700 });
    writeFileSync(join(home, 'config.json'), JSON.stringify({ version: 1, ...enabled,
        features: { ...enabled.features, webUi: { enabled: true } } }));
    const options = { home, nativeHome: join(root, 'mixdog'), stateDir: join(root, 'sessions'),
        enginePath: '/engine.mjs', trustPlugins: true };
    const saved = JSON.parse(readFileSync(configure(options), 'utf8'));
    assert.deepEqual(saved.features, {
        dictation: { ...enabled.features.dictation, enabled: false },
        voiceMode: { ...enabled.features.voiceMode, enabled: false },
        webUi: { enabled: true },
    });
    const fresh = join(root, 'fresh');
    const created = JSON.parse(readFileSync(configure({ ...options, home: fresh }), 'utf8'));
    assert.deepEqual(created.features, { dictation: { enabled: false }, voiceMode: { enabled: false } });
    const persisted = resolveSpeechConfig({ paseoHome: home, env: {}, persisted: saved });
    for (const provider of Object.values(persisted.speech.providers)) assert.equal(provider.enabled, false);
});
