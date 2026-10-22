import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { controlRuntime } from '../engine/src/controls.mjs';
import { resolveCompactionRoute } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/loop/fresh-context.mjs';
import { createCompactionSettings } from '../engine/node_modules/mixdog/src/session-runtime/settings-compaction-api.mjs';
import { normalizeCompactionConfig } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/config-helpers.mjs';
import { patchedComposerSource, COMPOSER_FILE } from '../scripts/patch-paseo-composer.mjs';

// 실제 RPC 스키마와 네이티브 설정 저장기를 메모리 구성으로 연결한다.
test('zero token override resets the native budget through the actual RPC contract', async () => {
    const require = createRequire(new URL('../plugin/package.json', import.meta.url));
    const source = stripTypeScriptTypes(readFileSync(new URL('../plugin/shared/controls.ts', import.meta.url), 'utf8'))
        .replace(/^import .*;\s*$/gm, '').replace(/export const /g, 'const ');
    const { input } = new Function('defineRpc', 'z', source + '; return engineControls;')(
        (value) => value, require('zod').z);
    let config = { compaction: { mainBufferTokens: 32000, summaryModel: 'other/small' } };
    const session = { compaction: { ...config.compaction } };
    const native = createCompactionSettings({
        getConfig: () => config, getSession: () => session,
        saveConfigAndAdopt: (value) => { config = value; },
        hasOwn: Object.hasOwn, normalizeCompactionConfig, invalidateContextStatusCache() {},
    });
    const runtime = {
        ...native,
        listProviderModels: async () => [], listWorkflows: () => [], listAgents: () => [],
        getOrchestrationMode: () => 'swarm',
        getAutoClear: () => ({}),
    };
    await controlRuntime(runtime, input.parse({ action: 'compaction', mainBufferTokens: 0, summaryModel: '' }));
    assert.equal(config.compaction.mainBufferTokens, 0);
    assert.equal(config.compaction.summaryModel, undefined);
    assert.equal(session.compaction.summaryModel, undefined);
    for (const mainBufferTokens of [-1, 1, 999, 500001]) {
        assert.equal(input.safeParse({ action: 'compaction', mainBufferTokens }).success, false);
        await assert.rejects(controlRuntime(runtime, { action: 'compaction', mainBufferTokens }), /Invalid mainBufferTokens/);
    }
    assert.equal(input.safeParse({ action: 'compaction', memoryTimeoutMs: 30000 }).success, false);
    await assert.rejects(controlRuntime(runtime, { action: 'compaction', memoryTimeoutMs: 30000 }), /지원하지/);
});

// 공급자 선택·모델 이름·원래 세션 유지와 명시적 비활성·초기화 실패 전파를 검증한다.
test('summary route uses its configured provider and preserves model IDs containing slashes', async () => {
    const main = { name: 'main', send() {} }, summary = { name: 'summary', send() {} };
    const session = { provider: 'main', model: 'large', compaction: { summaryModel: 'summary/org/small' } };
    const calls = [];
    const request = {
        sessionRef: session, provider: main, model: 'large',
        config: { providers: { main: {}, summary: {} } }, allowMaintenance: false,
        getProviderFn: (name) => { calls.push(name); return name === 'summary' ? summary : main; },
        initProvidersFn: async () => { calls.push('init'); },
    };
    const result = await resolveCompactionRoute(request);
    assert.equal(result.provider, summary);
    assert.equal(result.model, 'org/small');
    assert.equal(result.source, 'summary');
    assert.deepEqual(calls, ['init', 'summary']);
    assert.equal(session.provider, 'main');
    assert.equal(session.model, 'large');
    await assert.rejects(resolveCompactionRoute({
        ...request, config: { providers: { summary: { enabled: false } } },
    }), /disabled/);
    await assert.rejects(resolveCompactionRoute({
        ...request, initProvidersFn: async () => { throw new Error('initialization failed'); },
    }), /initialization failed/);
    const fallback = await resolveCompactionRoute({ ...request, sessionRef: { provider: 'main', model: 'large' } });
    assert.equal(fallback.provider, main);
    assert.equal(fallback.model, 'large');
});

// 설치된 웹 번들의 전체 원본 해시·재적용과 실제 렌더 목록을 함께 확인한다.
test('web settings hide unsupported timeout and describe background memory', () => {
    const source = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    assert.equal(patchedComposerSource(source), source);
    assert.ok(source.includes('children:[le,ie,ne,ae,ce,ue,me,ge]'));
    assert.ok(!source.includes('children:[le,ie,ne,ae,ce,ue,me,xe,ge]'));
    assert.ok(source.includes(String.raw`\ubc31\uadf8\ub77c\uc6b4\ub4dc \uba54\ubaa8\ub9ac (Recap)`));
});
