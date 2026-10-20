import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { controlRuntime, serveControlsStdio } from '../engine/src/controls.mjs';
import {
    createConfigWriters, flushPendingSessionConfigWrites,
} from '../engine/node_modules/mixdog/src/session-runtime/config-lifecycle/config-writers.mjs';
import { applyConfigPatch } from '../engine/node_modules/mixdog/src/runtime/shared/config-patch.mjs';
import { createStyleAndModeApi } from '../engine/node_modules/mixdog/src/session-runtime/workflow-agents-api/style-and-mode.mjs';
import { createOutputStyleStatusCache } from '../engine/node_modules/mixdog/src/session-runtime/config-lifecycle/output-style-cache.mjs';
import { outputStyleStatus } from '../engine/node_modules/mixdog/src/session-runtime/output-styles.mjs';

// 네이티브의 세 저장 채널을 임시 파일에 연결하고 디스크 완료 시점만 제어한다.
async function settingsFixture(t, { channel = 'config', fail = false } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'paseodog-host-settings-'));
    const path = join(directory, 'config.json');
    const initial = { default: { effort: 'low' }, skills: { disabled: [] }, outputStyle: 'default', peer: true };
    await writeFile(path, JSON.stringify(initial));
    let current = structuredClone(initial);
    let release, entered;
    const blocked = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    let failing = fail;
    let writes = 0;
    // 요청된 쓰기만 지연하고 기존 디스크의 다른 설정은 보존한다.
    async function persist(update) {
        writes += 1;
        entered();
        await blocked;
        if (failing) throw new Error('fixture disk unavailable');
        const disk = JSON.parse(await readFile(path, 'utf8'));
        await writeFile(path, JSON.stringify(update(disk)));
    }
    const writers = createConfigWriters({
        cfgMod: {
            saveConfigPatchAsync: (changes) => persist((disk) => applyConfigPatch(disk, changes)),
            patchSkillsDisabledAsync: (names) => persist((disk) => ({ ...disk, skills: { disabled: names } })),
        },
        sharedCfgMod: {
            updateConfigAsync: (update) => persist(update),
            pendingConfigWrites: async () => {},
        },
    });
    const runtime = {
        get effort() { return current.default.effort; },
        listProviderModels: async () => [],
        listAgents: async () => [],
        listWorkflows: async () => [],
        getOrchestrationMode: () => 'none',
        getDisabledSkills: () => current.skills,
        getOutputStyle: () => ({ current: { id: current.outputStyle } }),
        setRoute(route) {
            current = { ...current, default: { ...current.default, ...route } };
            writers.queueConfigChanges([{ path: ['default', 'effort'], value: route.effort }]);
        },
        setDisabledSkills(names) {
            current = { ...current, skills: { disabled: names } };
            writers.scheduleSkillsSave(names);
        },
        setOutputStyle(style) {
            current = { ...current, outputStyle: style };
            writers.scheduleOutputStyleSave(style);
        },
        close: async () => {},
    };
    const request = channel === 'config'
        ? { action: 'main', route: { effort: 'high' } }
        : { action: 'preferences', ...(channel === 'skills' ? { disabledSkills: ['worker'] } : { outputStyle: 'concise' }) };
    t.after(async () => {
        release();
        failing = false;
        await flushPendingSessionConfigWrites();
        await rm(directory, { recursive: true });
    });
    return {
        runtime, request, path, started, release, initial,
        writers,
        get current() { return current; },
        get writes() { return writes; },
        recover() { failing = false; },
    };
}

test('host settings acknowledgment waits for every native disk channel before a fresh process reads it', async (t) => {
    for (const channel of ['config', 'skills', 'outputStyle']) {
        await t.test(channel, async (t) => {
            const fixture = await settingsFixture(t, { channel });
            let acknowledged = false;
            const saving = controlRuntime(fixture.runtime, fixture.request).then((snapshot) => {
                acknowledged = true;
                return snapshot;
            });
            await fixture.started;
            assert.equal(acknowledged, false);
            assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), fixture.initial);
            fixture.release();
            await saving;
            const disk = JSON.parse(execFileSync(process.execPath, [
                '-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))', fixture.path,
            ], { encoding: 'utf8' }));
            assert.deepEqual(disk, fixture.current);
            assert.equal(fixture.writes, 1);
        });
    }
});

test('native output style normalization survives control snapshots, rereads and runtime reopen', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'paseodog-native-output-style-'));
    const path = join(directory, 'mixdog-config.json');
    const root = fileURLToPath(new URL('../engine/node_modules/mixdog/src/', import.meta.url));
    await writeFile(path, JSON.stringify({ peer: true }));
    t.after(async () => {
        await flushPendingSessionConfigWrites();
        await rm(directory, { recursive: true });
    });
    // 실제 네이티브 카탈로그·정규화·쓰기 채널을 연결해 재개방도 디스크에서 시작한다.
    function openRuntime() {
        let config = JSON.parse(readFileSync(path, 'utf8'));
        const cache = createOutputStyleStatusCache({
            cfgMod: { getPluginData: () => directory },
            STANDALONE_DATA_DIR: directory,
            resolve: (value) => value,
            performanceNow: () => performance.now(),
            outputStyleStatus: (dataDir, options) => outputStyleStatus(root, dataDir, options),
        });
        const writers = createConfigWriters({
            cfgMod: {},
            sharedCfgMod: {
                async updateConfigAsync(update) {
                    await writeFile(path, JSON.stringify(update(JSON.parse(await readFile(path, 'utf8')))));
                },
                pendingConfigWrites: async () => {},
            },
        });
        return {
            ...createStyleAndModeApi({
                ...cache,
                ...writers,
                getConfig: () => config,
                adoptConfig: (next) => { config = next; },
                displayConfig: () => config,
                getSession: () => null,
                invalidateContextStatusCache() {},
            }),
            listProviderModels: async () => [],
            listAgents: async () => [],
            listWorkflows: async () => [],
        };
    }
    let runtime = openRuntime();
    const initial = await controlRuntime(runtime, { action: 'read' });
    assert.equal(initial.outputStyle, 'simple');
    assert.deepEqual(initial.outputStyles.map((style) => style.id),
        ['default', 'detailed', 'simple', 'minimal', 'extreme-minimal']);
    for (const id of ['detailed', 'minimal', 'extreme-minimal', 'default', 'simple']) {
        const saved = await controlRuntime(runtime, {
            action: 'preferences', outputStyle: id.toUpperCase().replaceAll('-', '_'),
        });
        assert.equal(saved.outputStyle, id);
        assert.equal((await controlRuntime(runtime, { action: 'read' })).outputStyle, id);
        const disk = JSON.parse(await readFile(path, 'utf8'));
        assert.equal(disk.outputStyle, id === 'simple' ? undefined : id);
        assert.equal(disk.peer, true);
        runtime = openRuntime();
        assert.equal((await controlRuntime(runtime, { action: 'read' })).outputStyle, id);
    }
    await assert.rejects(controlRuntime(runtime, { action: 'preferences', outputStyle: 'missing-style-fixture' }),
        /output style must be one of/);
    assert.equal((await controlRuntime(openRuntime(), { action: 'read' })).outputStyle, 'simple');
});

test('native disk failures reject acknowledgments and retain settings for an explicit subsequent save', async (t) => {
    for (const channel of ['config', 'skills', 'outputStyle']) {
        await t.test(channel, async (t) => {
            const fixture = await settingsFixture(t, { channel, fail: true });
            const saving = controlRuntime(fixture.runtime, fixture.request);
            const rejected = assert.rejects(saving, /pending settings could not be saved/);
            await fixture.started;
            fixture.release();
            await rejected;
            assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), fixture.initial);
            assert.notDeepEqual(fixture.current, fixture.initial);
            assert.equal(fixture.writes, 1);
            fixture.recover();
            await controlRuntime(fixture.runtime, fixture.request);
            assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), fixture.current);
            assert.equal(fixture.writes, 2);
        });
    }
});

test('resident EOF drains serialized settings and responses before runtime close', async (t) => {
    const fixture = await settingsFixture(t);
    const input = new PassThrough();
    const output = new PassThrough();
    const frames = [];
    output.on('data', (chunk) => {
        for (const line of chunk.toString().trim().split('\n')) frames.push(JSON.parse(line));
    });
    let closed = false;
    fixture.runtime.close = async () => {
        assert.deepEqual(frames.map((frame) => [frame.id, frame.ok]), [['save', true], ['read', true]]);
        assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), fixture.current);
        closed = true;
    };
    let exited;
    const finished = new Promise((resolve) => { exited = resolve; });
    serveControlsStdio({
        input, output, openRuntime: async () => ({ runtime: fixture.runtime }),
        onExit: exited,
    });
    input.end(
        `${JSON.stringify({ id: 'save', request: fixture.request })}\n`
        + `${JSON.stringify({ id: 'read', request: { action: 'read' } })}\n`,
    );
    await fixture.started;
    assert.equal(closed, false);
    assert.deepEqual(frames, []);
    fixture.release();
    await finished;
    assert.equal(closed, true);
    assert.equal(frames[1].value.route.effort, 'high');
});

test('resident disk failure emits only an error and can recover without discarding pending settings', async (t) => {
    const fixture = await settingsFixture(t, { fail: true });
    const input = new PassThrough();
    const output = new PassThrough();
    let received;
    const response = new Promise((resolve) => { received = resolve; });
    output.once('data', (chunk) => received(JSON.parse(chunk.toString())));
    let exited;
    const finished = new Promise((resolve) => { exited = resolve; });
    serveControlsStdio({
        input, output, openRuntime: async () => ({ runtime: fixture.runtime }), onExit: exited,
    });
    input.write(`${JSON.stringify({ id: 'save', request: fixture.request })}\n`);
    await fixture.started;
    fixture.release();
    const frame = await response;
    assert.equal(frame.ok, false);
    assert.equal(frame.value, undefined);
    assert.match(frame.error, /pending settings could not be saved/);
    assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), fixture.initial);
    fixture.recover();
    await controlRuntime(fixture.runtime, fixture.request);
    input.end();
    await finished;
    assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), fixture.current);
});
