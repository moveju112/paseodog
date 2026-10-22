import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactionBufferRatio, migrateCompactionBuffer } from '../engine/src/compaction-buffer.mjs';
import { COMPACTION_BUFFER, COMPACTION_BUFFER_ANCHOR, withCompactionBuffer, withoutCompactionBuffer } from '../patches/paseo-compaction-buffer.mjs';
import { controlRuntime } from '../engine/src/controls.mjs';
import { createNativeEngine } from '../engine/src/native-engine.mjs';
import { resolveSessionCompactPolicy } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/context-compaction-policy.mjs';

// 앱의 20%(0.2)가 Mixdog에서 실제 20% 여유 버퍼(압축 시점 80%)가 되는지 원본 정책 함수로 확인한다.
test('app buffer ratio reaches Mixdog as a real percentage of the window', async () => {
    const calls = [];
    const runtime = { setCompactionSettings: (patch) => calls.push(patch), getCompactionSettings: () => ({}),
        listProviderModels: async () => [], listWorkflows: () => [], listAgents: () => [],
        getOrchestrationMode: () => 'none' };
    await controlRuntime(runtime, { action: 'compaction', mainBufferPercent: 0.2 });
    assert.deepEqual(calls, [{ mainBufferRatio: 0.2 }]);
    const policy = resolveSessionCompactPolicy({ compaction: calls[0] }, 500000);
    assert.equal(policy.bufferTokens, 100000);
    assert.equal(policy.triggerTokens, 400000);
    await assert.rejects(controlRuntime(runtime, { action: 'compaction', mainBufferPercent: 0.3 }), /Invalid mainBufferPercent/);
});

// 이전 앱이 퍼센트 키에 저장한 비율(0.2 -> 실제 0.2%)만 비율 키로 옮기고 나머지 표현은 유지한다.
test('legacy ratio stored under the percent key migrates once', () => {
    const legacy = { onModelChange: true, mainBufferPercent: 0.2 };
    const migrated = migrateCompactionBuffer(legacy);
    assert.deepEqual(migrated, { onModelChange: true, mainBufferRatio: 0.2 });
    assert.equal(resolveSessionCompactPolicy({ compaction: legacy }, 500000).bufferTokens, 1000);
    assert.equal(resolveSessionCompactPolicy({ compaction: migrated }, 500000).bufferTokens, 100000);
    for (const kept of [{ mainBufferPercent: 20 }, { mainBufferRatio: 0.1 }, { mainBufferPercent: 0.2, mainBufferTokens: 32000 }, { auto: false }])
        assert.equal(migrateCompactionBuffer(kept), kept);
    assert.equal(migrateCompactionBuffer(undefined), undefined);
    assert.deepEqual(migrateCompactionBuffer({ mainBufferPercent: 0.3 }), { mainBufferRatio: 0.25 });
    assert.deepEqual(migrateCompactionBuffer(migrated), migrated);
    assert.deepEqual(migrateCompactionBuffer({ mainBufferPercent: 0.4 }), { mainBufferPercent: 0.4 });
});

// 다음 턴 직전 실제 브리지 경로가 설정을 이관하고 원본 정책상 80% 경계로 동작하는지 무과금 대역으로 확인한다.
test('native bridge adopts the migrated buffer before the next request', async () => {
    let config = { compaction: { auto: true, onModelChange: true, mainBufferPercent: 0.2 } };
    let observed;
    const runtime = {
        ask() {
            observed = resolveSessionCompactPolicy({ compaction: config.compaction }, 500000);
            return {};
        },
        abort() {}, close() {}, resume() {}, compact() {},
        setCompactionSettings(compaction) { config = { ...config, compaction }; },
    };
    const engine = await createNativeEngine({
        config: { cwd: '/work', mode: 'ask', mcpServers: {}, settings: {} },
    }, { modules: {
        loadConfig: () => config,
        createMixdogSessionRuntime: async (options) => {
            options.agentSessionSurface({ mgr: {}, getAgentTool: () => ({
                getStatus: () => ({ jobs: [] }), onStatusChange: () => () => {},
                closeAll: async () => ({ failed: [] }),
            }) });
            return runtime;
        },
    } });
    try {
        await engine.ask('test without inference', {});
        assert.equal(observed.triggerTokens, 400000);
        assert.deepEqual(config.compaction, { auto: true, onModelChange: true, mainBufferRatio: 0.2 });
    } finally { await engine.close(); }
});

// 웹 번들 선택지는 앱 원본과 같은 값·문구이고, 적용·되돌리기·이중 적용 거부가 정확하다.
test('web bundle buffer options match the shared app source', () => {
    const decode = (text) => text.replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})/g, (_, byte, unit) => String.fromCharCode(parseInt(byte || unit, 16)));
    const options = (text) => [...text.matchAll(/value:\s*"([\d.]+)",\s*label:\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]);
    const app = readFileSync(new URL('../android/packages/app/src/screens/settings/ai-engine-page.tsx', import.meta.url), 'utf8');
    const appOptions = options(app.slice(app.indexOf('const bufferOptions'), app.indexOf('] as const', app.indexOf('const bufferOptions'))));
    assert.deepEqual(options(decode(COMPACTION_BUFFER)), appOptions);
    assert.deepEqual(appOptions.map(([value]) => value), ['0.1', '0.2', '0.25']);
    const bundle = `a=1,_=${COMPACTION_BUFFER_ANCHOR},b=2`;
    const patched = withCompactionBuffer(bundle);
    assert.ok(patched.includes(COMPACTION_BUFFER) && !patched.includes(COMPACTION_BUFFER_ANCHOR));
    assert.equal(withoutCompactionBuffer(patched), bundle);
    assert.throws(() => withCompactionBuffer(patched), /compaction buffer anchor mismatch/);
});

// 설정 화면에는 저장 표현과 무관하게 비율로 보여 준다.
test('buffer ratio is projected from every stored representation', () => {
    assert.equal(compactionBufferRatio({ mainBufferRatio: 0.25 }), 0.25);
    assert.equal(compactionBufferRatio({ mainBufferRatio: 20 }), 0.2);
    assert.equal(compactionBufferRatio({ mainBufferPercent: 10 }), 0.1);
    assert.equal(compactionBufferRatio({ mainBufferPercent: 0.2 }), 0.2);
    assert.equal(compactionBufferRatio({ mainBufferPercent: 0.4 }), 0.004);
    assert.equal(compactionBufferRatio({ mainBufferPercent: 30 }), 0.25);
    assert.equal(compactionBufferRatio({}), undefined);
});
