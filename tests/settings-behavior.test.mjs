import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { Script, runInNewContext } from 'node:vm';
import { createNativeEngine } from '../engine/src/native-engine.mjs';
import { controlRuntime } from '../engine/src/controls.mjs';
import { createStandaloneHookBus } from '../engine/node_modules/mixdog/src/session-runtime/services/hook-bus.mjs';
import { changeHookSettings, readHookSettings } from '../engine/src/hook-settings.mjs';
import { patchedComposerSource, COMPOSER_FILE } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';
import { withSettingsBehavior, withoutSettingsBehavior } from '../patches/paseo-settings-behavior.mjs';

// 원래 세션의 모델·본문을 기록하는 무과금 런타임. 실제 어댑터 configure 경로를 호출한다.
async function modelFixture(t, { compaction = {}, messages, compactResult = { changed: true }, invalid = false } = {}) {
    const calls = [];
    const session = {
        id: 'same-session', provider: 'first', model: 'one',
        messages: messages ?? [{ role: 'user', content: 'request' }, { role: 'assistant', content: 'answer' }],
    };
    const runtime = {
        id: session.id, session, ask() {}, abort() {}, close() {}, resume() {},
        setCompactionSettings(value) { calls.push(['settings', value]); },
        setRoute(value, options) {
            calls.push([options.validateOnly ? 'validate' : 'route', value, options]);
            if (invalid) throw new Error('unavailable model');
            if (!options.validateOnly) Object.assign(runtime.session, value);
        },
        compact() {
            calls.push(['compact', runtime.session.provider, runtime.session.model]);
            if (compactResult instanceof Error) throw compactResult;
            return compactResult;
        },
    };
    let disk = { compaction };
    const engine = await createNativeEngine({
        config: { cwd: '/work', mode: 'ask', mcpServers: {}, settings: {} }, effortOptions: ['low', 'high'],
    }, { modules: { loadConfig: () => disk, createMixdogSessionRuntime: async () => runtime } });
    t.after(() => engine.close());
    return { engine, runtime, session, calls, save: (next) => { disk = next; } };
}

test('model switch validates first, compacts with the old model and latest summary settings, then preserves the session', async (t) => {
    const f = await modelFixture(t, { compaction: { onModelChange: false } });
    f.save({ compaction: { auto: false, onModelChange: true, summaryModel: 'summary/small', mainBufferTokens: 32000 } });
    const originalMessages = f.session.messages;
    const result = await f.engine.configure({ route: { provider: 'second', model: 'two' } });
    assert.deepEqual(f.calls.map(([kind]) => kind), ['validate', 'settings', 'compact', 'route']);
    assert.deepEqual(f.calls[2], ['compact', 'first', 'one']);
    assert.equal(f.calls[1][1].summaryModel, 'summary/small');
    assert.equal(f.calls[1][1].auto, false);
    assert.equal(f.calls[1][1].mainBufferTokens, 32000);
    assert.deepEqual(f.calls[3][2], { applyToCurrentSession: true, sessionOnly: true, keepMainModel: true });
    assert.equal(result.route.model, 'two');
    assert.equal(f.engine.id, 'same-session');
    assert.equal(f.session.messages, originalMessages);
});

test('a saved opt-out is honored immediately, independently of ordinary automatic compaction', async (t) => {
    const f = await modelFixture(t, { compaction: { onModelChange: true } });
    f.save({ compaction: { auto: true, onModelChange: false } });
    await f.engine.configure({ route: { provider: 'second', model: 'two' } });
    assert.deepEqual(f.calls.map(([kind]) => kind), ['validate', 'route']);
});

test('default-on model-switch compaction clears an obsolete summary model override', async (t) => {
    const f = await modelFixture(t);
    f.save({});
    await f.engine.configure({ route: { provider: 'first', model: 'two' } });
    assert.equal(f.calls[1][1].summaryModel, '');
    assert.equal(f.calls.filter(([kind]) => kind === 'compact').length, 1);
});

test('empty sessions, same-model choices, Fast, context and effort changes do not compact', async (t) => {
    const empty = await modelFixture(t, { messages: [] });
    await empty.engine.configure({ route: { provider: 'second', model: 'two' } });
    assert.deepEqual(empty.calls.map(([kind]) => kind), ['route']);
    const f = await modelFixture(t);
    for (const changes of [
        { route: { provider: 'first', model: 'one' } }, { route: { fast: true } },
        { route: { contextPercent: 70 } }, { effort: 'high' },
    ]) await f.engine.configure(changes);
    assert.deepEqual(f.calls.map(([kind]) => kind), ['route', 'route', 'route']);
});

test('an invalid model fails before settings adoption or compaction', async (t) => {
    const f = await modelFixture(t, { invalid: true });
    await assert.rejects(f.engine.configure({ route: { provider: 'second', model: 'missing' } }), /unavailable model/);
    assert.deepEqual(f.calls.map(([kind]) => kind), ['validate']);
    assert.equal(f.session.model, 'one');
});

test('abort during model-switch compaction prevents a late model change', async (t) => {
    const f = await modelFixture(t);
    let finish;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.runtime.compact = () => {
        entered();
        return new Promise(resolve => { finish = resolve; });
    };
    const pending = f.engine.configure({ route: { provider: 'second', model: 'two' } });
    const rejected = assert.rejects(pending, /모델 변경이 취소/);
    await started;
    await f.engine.abort('user canceled');
    finish({ changed: true });
    await rejected;
    assert.equal(f.session.model, 'one');
    assert.equal(f.calls.some(([kind]) => kind === 'route'), false);
});

test('failed, missing or busy compaction results preserve the original route and never retry', async (t) => {
    for (const compactResult of [new Error('provider failed'), { error: 'provider failed' }, null,
        { changed: false, reason: 'compact skipped: turn in progress' }]) {
        const f = await modelFixture(t, { compactResult });
        await assert.rejects(f.engine.configure({ route: { provider: 'second', model: 'two' } }), /자동 압축에 실패/);
        assert.deepEqual(f.calls.map(([kind]) => kind), ['validate', 'settings', 'compact']);
        assert.equal(f.session.model, 'one');
    }
});

test('a legitimate no-change compact result permits switching; replacing the session during compact does not', async (t) => {
    const f = await modelFixture(t, { compactResult: { changed: false, reason: 'below threshold' } });
    await f.engine.configure({ route: { provider: 'second', model: 'two' } });
    assert.equal(f.session.model, 'two');
    const replaced = await modelFixture(t);
    replaced.runtime.compact = () => {
        replaced.runtime.session = { ...replaced.session, id: 'another-session' };
        return { changed: true };
    };
    await assert.rejects(replaced.engine.configure({ route: { provider: 'second', model: 'two' } }), /세션이 변경/);
    assert.equal(replaced.runtime.session.model, 'one');
});

function hookFixture(t) {
    const directory = mkdtempSync('/data/tmp/ubuntu/paseodog-hook-settings-');
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const bus = createStandaloneHookBus({ dataDir: directory });
    const status = { rulesPath: join(directory, 'hooks.json') };
    const runtime = {
        hooksStatus: () => status, flushHookRules: () => bus.flushRules(),
        listProviderModels: () => [], listAgents: () => [], listWorkflows: () => [],
        getOrchestrationMode: () => 'none',
    };
    const change = async (request) => (await controlRuntime(runtime, { action: 'preferences', ...request })).hooks.rules;
    return { directory, bus, status, runtime, change };
}

test('all offered lifecycle hooks pass the real RPC contract and execute only after explicit enable', async (t) => {
    const require = createRequire(new URL('../plugin/package.json', import.meta.url));
    const source = stripTypeScriptTypes(readFileSync(new URL('../plugin/shared/controls.ts', import.meta.url), 'utf8'))
        .replace(/^import .*;\s*$/gm, '').replace(/export const /g, 'const ');
    const { input } = new Function('defineRpc', 'z', source + '; return engineControls;')(v => v, require('zod').z);
    const f = hookFixture(t);
    for (const event of ['PreToolUse', 'PostToolUse', 'Stop']) {
        const marker = join(f.directory, `${event}.txt`);
        const command = `"${process.execPath}" -e ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)}`;
        const added = await controlRuntime(f.runtime, input.parse({
            action: 'preferences', hookAction: 'add', hookRule: { event, command, matcher: 'Write' },
        }));
        const row = added.hooks.rules.find(row => row.event === event);
        assert.equal(row.enabled, false);
        assert.equal((await f.bus.dispatch(event, { cwd: f.directory, name: 'Write' })).handlersRun, undefined);
        const enabled = await f.change(input.parse({
            action: 'preferences', hookAction: 'toggle', hookIndex: row.index, hookRevision: row.revision, enabled: true,
        }));
        assert.equal(enabled.find(row => row.event === event).enabled, true);
        assert.equal((await f.bus.dispatch(event, { cwd: f.directory, name: 'Write' })).handlersRun, 1);
        assert.equal(readFileSync(marker, 'utf8'), 'ran');
        const current = enabled.find(row => row.event === event);
        const disabled = await f.change({ hookAction: 'toggle', hookIndex: current.index, hookRevision: current.revision, enabled: false });
        assert.equal((await f.bus.dispatch(event, { cwd: f.directory, name: 'Write' })).handlersRun, undefined);
        const off = disabled.find(row => row.event === event);
        const deleted = await f.change({ hookAction: 'delete', hookIndex: off.index, hookRevision: off.revision });
        assert.equal(deleted.some(row => row.event === event), false);
    }
});

test('lifecycle settings preserve native deny rules and reject stale edits instead of changing another rule', async (t) => {
    const f = hookFixture(t);
    f.bus.addRule({ tool: 'shell', action: 'deny', reason: 'keep blocked', enabled: true });
    const before = readFileSync(f.status.rulesPath, 'utf8');
    const rows = await f.change({ hookAction: 'add', hookRule: { event: 'PostToolUse', command: 'echo ok' } });
    assert.equal(rows[0].event, '도구 정책 · deny');
    assert.equal(rows[0].matcher, 'shell');
    assert.match(rows[0].command, /keep blocked/);
    assert.equal(readFileSync(f.status.rulesPath, 'utf8'), before);
    assert.equal((await f.bus.beforeTool({ cwd: f.directory, name: 'shell', args: {} })).action, 'deny');
    await f.change({ hookAction: 'add', hookRule: { event: 'Stop', command: 'echo later' } });
    await assert.rejects(f.change({ hookAction: 'delete', hookIndex: rows[1].index, hookRevision: rows[1].revision }), /새로고침/);
    assert.equal(readHookSettings(f.status).rules.length, 3);
    const current = readHookSettings(f.status).rules[0];
    await f.change({ hookAction: 'toggle', hookIndex: current.index, hookRevision: current.revision, enabled: false });
    assert.equal(await f.bus.beforeTool({ cwd: f.directory, name: 'shell', args: {} }), null);
});

test('malformed hook files and invalid input are rejected without overwriting existing data', (t) => {
    const f = hookFixture(t);
    assert.throws(() => changeHookSettings(f.status, { hookAction: 'add', hookRule: { event: 'Unknown', command: 'echo no' } }), /이벤트/);
    writeFileSync(f.status.rulesPath, '{broken');
    assert.throws(() => changeHookSettings(f.status, { hookAction: 'add', hookRule: { event: 'Stop', command: 'echo no' } }));
    assert.equal(readFileSync(f.status.rulesPath, 'utf8'), '{broken');
});

test('web settings patch is reversible, hash-gated, and persists before publishing state', async () => {
    const bundle = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const source = composerFixture(bundle);
    new Script(source);
    assert.equal(composerFixture(source), source);
    assert.equal(withSettingsBehavior(withoutSettingsBehavior(source)), source);
    assert.throws(() => patchedComposerSource(source + '// drift'), /hash mismatch/);
    const start = source.indexOf('_e.saveAppSettings=(()=>');
    const end = source.indexOf(',_e.loadAppSettingsFromStorage=Q', start);
    let cache = { enabled: true }, disk = { enabled: true }, error = null;
    let fail = true;
    const sandbox = {
        _e: {}, V: value => ({ ...value }), F: ['app-settings'], Q: async () => disk,
        ie: async () => ({}), h: { APP_SETTINGS_KEY: 'settings' }, J: { parse: () => ({}) },
        re: async (_storage, _stored, value) => { if (fail) throw new Error('disk full'); disk = value; },
    };
    runInNewContext(source.slice(start, end), sandbox);
    const queryClient = {
        getQueryData: () => cache,
        setQueryData(key, value) { if (key[0] === 'app-settings') cache = value; else error = value; },
    };
    await assert.rejects(sandbox._e.saveAppSettings({ queryClient, updates: { enabled: false }, deps: { storage: {} } }), /disk full/);
    assert.equal(cache.enabled, true);
    assert.equal(disk.enabled, true);
    assert.match(error, /저장하지 못했어요/);
    fail = false;
    await Promise.all([
        sandbox._e.saveAppSettings({ queryClient, updates: { enabled: false }, deps: { storage: {} } }),
        sandbox._e.saveAppSettings({ queryClient, updates: current => ({ peer: current.enabled }), deps: { storage: {} } }),
    ]);
    assert.equal(cache.enabled, false);
    assert.equal(cache.peer, false);
    assert.equal(disk.peer, false);
    assert.equal(error, null);
});
