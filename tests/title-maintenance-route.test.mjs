import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import vm from 'node:vm';
import { basicAgentIds, isBasicAgent } from '../android/packages/app/src/screens/settings/basic-agent-roles.ts';
import { generateConversationTitle } from '../engine/src/session-title.mjs';
import { resolveMaintenanceRoute } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/agent-runtime/maintenance-route.mjs';
import { resultText } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/agent-runtime/completion-text.mjs';
import { roleProviderCacheOpts } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/agent-runtime/cache-strategy.mjs';
import { AGENT_PATCHES, ADDITION, PIN, patch, patchedAgentSource } from '../scripts/patch-mixdog.mjs';
import { SESSION_TITLE_ROUTE_PATCH } from '../patches/session-title-route.mjs';
import { BUILTIN_AGENTS, BUILTIN_AGENT_FILES, SOLO_BASIC_ROLE_IDS } from '../patches/builtin-agents.mjs';
import { withEffectiveDisabledAgents } from '../engine/node_modules/mixdog/src/runtime/shared/agent-route-config.mjs';
import { builtinFeatureActive } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/builtin-features.mjs';
import { stripAgentSectionDefaults } from '../engine/node_modules/mixdog/src/runtime/shared/defaults-separation.mjs';
import { setModuleEnabledInConfig } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/config-helpers.mjs';
import { canonicalizeModulesStorage } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/config-storage.mjs';
import { compactionSummaryPlan } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/loop/fresh-context.mjs';
import { BASIC_AGENTS_WEB_EDITS, AGENTS_SETTINGS_BEFORE, withAgentsSettings, withoutAgentsSettings } from '../patches/paseo-agents-settings.mjs';

// 네이티브 팩토리를 그대로 실행하고 설정 읽기와 공급자 I/O만 메모리로 치환한다.
const titleSource = readFileSync(new URL(
    '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/agent-runtime/title-completion.mjs', import.meta.url), 'utf8');
const createTitleCompletion = vm.runInNewContext(titleSource
    .replace(/^import .+;\n/gm, '')
    .replace('export const generateSessionTitle = createTitleCompletion();', 'createTitleCompletion;'), {
    resolveMaintenanceRoute, resultText, roleProviderCacheOpts,
});

function config() {
    return {
        default: { provider: 'openai-oauth', model: 'gpt-6.1-sol', effort: 'high' },
        agents: {
            maintainer: { provider: 'anthropic-oauth', model: 'configured-maintainer', effort: 'high' },
            'title-generator': { provider: 'openai-oauth', model: 'gpt-6-luna', effort: 'low' },
            'context-compressor': { provider: 'anthropic-oauth', model: 'configured-compressor', effort: 'low' },
        },
        providers: { 'openai-oauth': { enabled: true }, 'anthropic-oauth': { enabled: true } },
        disabledAgents: [],
    };
}

function completion(settings, send = async () => ({ content: '사용량 자동 갱신' })) {
    const calls = [], initializations = [], providers = [];
    const generate = createTitleCompletion({
        loadConfig: () => settings,
        initProviders: async (value, options) => { initializations.push({ value, options }); },
        getProvider: (name) => {
            providers.push(name);
            return { send: async (...args) => { calls.push(args); return send(...args); } };
        },
    });
    return { generate, calls, initializations, providers };
}

test('title route uses its own selected model without changing main or memory routes', () => {
    assert.ok(AGENT_PATCHES.includes(SESSION_TITLE_ROUTE_PATCH));
    const settings = config();
    for (const main of [
        settings.default,
        { provider: 'anthropic-oauth', model: 'main-opus', effort: 'high' },
        { provider: 'google', model: 'main-astra', effort: 'high' },
    ]) {
        settings.default = main;
        const before = structuredClone(settings);
        assert.deepEqual(resolveMaintenanceRoute({ agent: 'title-agent', config: settings }), {
            provider: 'openai-oauth', model: 'gpt-6-luna', effort: 'low', fast: false,
        });
        assert.deepEqual(resolveMaintenanceRoute({ agent: 'cycle1-agent', config: settings }), {
            ...settings.agents.maintainer, fast: false,
        });
        assert.deepEqual(settings, before);
    }
    delete settings.agents.maintainer;
    assert.equal(resolveMaintenanceRoute({ agent: 'cycle1-agent', config: settings }).model, settings.default.model);
    assert.equal(resolveMaintenanceRoute({ agent: 'title-agent', config: settings }).model, 'gpt-6-luna');
    settings.agents['title-generator'] = { provider: 'anthropic-oauth', model: 'another-title-model', effort: 'medium' };
    assert.equal(resolveMaintenanceRoute({ agent: 'title-agent', config: settings }).model, 'another-title-model');
    delete settings.agents['title-generator'];
    assert.equal(resolveMaintenanceRoute({ agent: 'title-agent', config: settings }), null);
});

test('conversation title makes one tool-free Luna request with only its dedicated prompt', async () => {
    const settings = config();
    const before = structuredClone(settings);
    const native = completion(settings);
    const result = await generateConversationTitle({
        currentTitle: '임시 제목', provisional: true, conversation: '사용량 자동 갱신을 구현해줘',
    }, { config: () => settings, generate: native.generate });
    assert.deepEqual(result, { title: '사용량 자동 갱신' });
    assert.equal(native.calls.length, 1);
    assert.equal(native.initializations.length, 1);
    assert.equal(native.initializations[0].value, settings.providers);
    assert.deepEqual(native.providers, ['openai-oauth']);
    const [messages, model, tools, options] = native.calls[0];
    assert.equal(model, 'gpt-6-luna');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /Output only one title/);
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /Keep the current title EXACTLY/);
    assert.match(messages[1].content, /사용량 자동 갱신을 구현해줘/);
    assert.doesNotMatch(messages.map(({ content }) => content).join('\n'), /gpt-6.1-sol|configured-maintainer/);
    assert.equal(tools, undefined);
    assert.equal(options.effort, 'low');
    assert.equal(options.fast, false);
    assert.equal(options.maxOutputTokens, 128);
    assert.equal(options.retry529, false);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal, native.initializations[0].options.signal);
    assert.deepEqual(settings, before);
});

test('disabled title agent or its provider does not initialize or call any provider', async () => {
    for (const disable of [
        (settings) => { settings.disabledAgents.push('title-generator'); },
        (settings) => { settings.providers['openai-oauth'].enabled = false; },
    ]) {
        const settings = config();
        disable(settings);
        const native = completion(settings);
        await assert.rejects(native.generate('작업 제목'), { code: 'MAINTENANCE_ROUTE_UNRESOLVED' });
        assert.equal(native.initializations.length, 0);
        assert.equal(native.providers.length, 0);
        assert.equal(native.calls.length, 0);
    }
});

test('all basic roles start off while explicit enabled choices and selected models survive', () => {
    const disabled = withEffectiveDisabledAgents({}).disabledAgents;
    for (const id of [...BUILTIN_AGENTS.map(({ id }) => id), 'maintainer', 'reviewer'])
        assert.ok(disabled.includes(id), id);
    assert.equal(builtinFeatureActive({}, 'webSearch'), false);
    assert.equal(builtinFeatureActive({ modules: { webSearch: { enabled: true } } }, 'webSearch'), true);
    const settings = config();
    settings.disabledAgents = ['maintainer'];
    assert.equal(resolveMaintenanceRoute({ agent: 'title-agent', config: settings }).model, 'gpt-6-luna');
    const stored = { enabledAgents: ['title-generator'], agents: settings.agents };
    const restored = withEffectiveDisabledAgents(stored);
    assert.ok(!restored.disabledAgents.includes('title-generator'));
    assert.ok(restored.disabledAgents.includes('maintainer'));
    assert.deepEqual(restored.agents, settings.agents);
    for (const { file, content } of BUILTIN_AGENT_FILES)
        assert.equal(readFileSync(new URL('../engine/node_modules/mixdog/' + file, import.meta.url), 'utf8'), content);
});

test('enabled compressor selects its own single route and failure never tries the main or maintainer', async () => {
    const settings = config();
    settings.compaction = { summaryModel: 'old-provider/old-summary-model' };
    const main = { name: 'openai-oauth', send() { assert.fail('must not call main'); } };
    const compressor = { send() {}, getCachedModelInfo: () => ({ contextWindow: 128000 }) };
    const initialized = [];
    const input = {
        provider: main, model: 'gpt-6.1-sol',
        sessionRef: { id: 'test-compression', provider: 'openai-oauth', model: 'gpt-6.1-sol' },
        config: settings,
        initProvidersFn: async (providers) => { initialized.push(providers); },
        getProviderFn: (name) => { assert.equal(name, 'anthropic-oauth'); return compressor; },
    };
    const plan = compactionSummaryPlan(input);
    assert.equal(plan.mode, 'explicit');
    assert.equal(plan.steps.length, 1);
    const route = await plan.steps[0]();
    assert.equal(route.provider, compressor);
    assert.equal(route.model, 'configured-compressor');
    assert.equal(route.source, 'context-compressor');
    assert.equal(initialized.length, 1);
    const unavailable = compactionSummaryPlan({ ...input, getProviderFn: () => null });
    await assert.rejects(unavailable.steps[0](), /compact summary route unavailable/);
    assert.equal(unavailable.steps.length, 1);
    settings.disabledAgents.push('context-compressor');
    settings.compaction = { summaryMode: 'self' };
    const baseline = compactionSummaryPlan(input);
    assert.equal(baseline.mode, 'self');
    assert.equal((await baseline.steps[0]()).model, 'gpt-6.1-sol');
});

test('web search keeps explicit enable across saves, reloads and unrelated settings changes', () => {
    let config = { modules: { tidy: { enabled: false }, git: { enabled: true } } };
    assert.equal(builtinFeatureActive(config, 'webSearch'), false);
    for (const enabled of [true, true, false, true, false]) {
        config = setModuleEnabledInConfig(config, 'webSearch', enabled);
        for (let save = 0; save < 3; save++) {
            const saved = JSON.parse(JSON.stringify(stripAgentSectionDefaults({ ...config, outputStyle: 'default' })));
            assert.equal(saved.modules?.webSearch?.enabled, enabled ? true : undefined);
            assert.deepEqual(saved.modules.tidy, { enabled: false });
            assert.equal(saved.modules.git, undefined);
            config = { ...saved, modules: canonicalizeModulesStorage(saved.modules) || {} };
            assert.equal(builtinFeatureActive(config, 'webSearch'), enabled);
        }
    }
});

test('web basic-agent grouping matches the app and round-trips with drift and partial-patch rejection', () => {
    const source = [AGENTS_SETTINGS_BEFORE, ...BASIC_AGENTS_WEB_EDITS.map(([before]) => before),
        'r?.webSearch??!0', 'l.toolModules?.webSearch??!0'].join(';');
    const patched = withAgentsSettings(source);
    assert.equal(withoutAgentsSettings(patched), source);
    assert.throws(() => withAgentsSettings(patched), /anchor mismatch/);
    const [before, after] = BASIC_AGENTS_WEB_EDITS[0];
    assert.throws(() => withoutAgentsSettings(patched.replace(after, before)), /Partial/);
    const names = ['maintainer', ...BUILTIN_AGENTS.map(({ id }) => id), 'reviewer'];
    assert.deepEqual([...basicAgentIds], names);
    const predicates = vm.runInNewContext(BASIC_AGENTS_WEB_EDITS[0][1] + ';({basic:ce,other:re})');
    for (const id of [...names, 'worker', 'custom-bot']) {
        assert.equal(predicates.basic({ id }), isBasicAgent({ id }));
        assert.equal(predicates.other({ id }), !isBasicAgent({ id }));
    }
    assert.equal(predicates.basic({ id: 'worker' }), false);
    assert.equal(predicates.other({ id: 'worker' }), true);
    assert.doesNotMatch(patched, /webSearch\?\?!0/);
});

test('added default definitions are version-gated, idempotent and validated before any writes', (t) => {
    const root = mkdtempSync('/data/tmp/ubuntu/paseodog-builtin-agents-');
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const write = (file, text) => {
        const target = join(root, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
    };
    write('package.json', JSON.stringify({ version: PIN }));
    const primary = 'src/session-runtime/turn/turn-run.mjs';
    const original = readFileSync(new URL('../engine/node_modules/mixdog/' + primary, import.meta.url), 'utf8').replace(ADDITION, '');
    write(primary, original);
    for (const spec of AGENT_PATCHES) {
        let source = readFileSync(new URL('../engine/node_modules/mixdog/' + spec.file, import.meta.url), 'utf8');
        for (const [before, after] of [...spec.edits].reverse()) source = source.replace(after, () => before);
        write(spec.file, source);
    }
    assert.throws(() => patch(root, { check: true }), /patch is missing/);
    patch(root);
    patch(root, { check: true });
    patch(root);
    for (const { file, content } of BUILTIN_AGENT_FILES)
        assert.equal(readFileSync(join(root, file), 'utf8'), content);
    write(primary, original);
    write(BUILTIN_AGENT_FILES[0].file, 'user-authored definition');
    assert.throws(() => patch(root), /added source drift/);
    assert.equal(readFileSync(join(root, primary), 'utf8'), original);
    write('package.json', '{"version":"unsupported"}');
    assert.throws(() => patch(root), /required; found unsupported/);
});

test('Luna failure is propagated once without retrying or falling back to Sol or the maintainer', async () => {
    const settings = config();
    const failure = new Error('title provider failed');
    const native = completion(settings, async () => { throw failure; });
    await assert.rejects(native.generate('작업 제목'), (error) => error === failure);
    assert.equal(native.calls.length, 1);
    assert.deepEqual(native.providers, ['openai-oauth']);
    assert.equal(native.calls[0][1], 'gpt-6-luna');
});

test('unavailable title provider never uses an initialized main provider', async () => {
    const providers = [];
    const generate = createTitleCompletion({
        loadConfig: config,
        initProviders: async () => {},
        getProvider: (name) => { providers.push(name); return null; },
    });
    await assert.rejects(generate('작업 제목'), /Session title provider is unavailable: openai-oauth/);
    assert.deepEqual(providers, ['openai-oauth']);
});

// 단독 모드에서도 켜진 기본 역할만 설명의 조건에서 메인이 직접 호출하고 다른 에이전트는 사용자 요청을 기다린다.
test('solo mode exposes enabled basic roles for conditional use while other agents still need a request', async () => {
    const spec = AGENT_PATCHES.find(({ file }) => file.endsWith('runtime-core/workflow/context.mjs'));
    const installed = readFileSync(new URL(`../engine/node_modules/mixdog/${spec.file}`, import.meta.url), 'utf8');
    const source = patchedAgentSource(installed, spec);
    assert.equal(patchedAgentSource(source, spec), source);
    const runtime = '../engine/node_modules/mixdog/src/runtime';
    const orchestration = await import(`${runtime}/agent/orchestrator/runtime-core/orchestration.mjs`);
    const ids = await import(`${runtime}/agent/orchestrator/runtime-core/workflow-ids.mjs`);
    const createWorkflowContext = vm.runInNewContext(source.replace(/^import .+;\n/gm, '')
        .replace('export function createWorkflowContext', 'function createWorkflowContext') + '\ncreateWorkflowContext;', {
        ...orchestration, ...ids,
        clean: (await import(`${runtime}/agent/orchestrator/runtime-core/session-text.mjs`)).clean,
        configuredOrchestrationMode: (await import(`${runtime}/shared/orchestration.mjs`)).configuredOrchestrationMode,
    });
    const context = (mode, enabled) => createWorkflowContext({
        packs: { activeWorkflowId: () => 'none', loadWorkflowPack: () => ({ id: 'none' }) },
        agents: {
            delegatableAgentIds: () => enabled,
            loadAgentDefinition: (_dir, id) => ({ id, name: id, description: `${id} condition` }),
        },
    }).activeWorkflowContext({ orchestrationMode: mode }, '/fixture').context;
    const solo = context('none', ['advisor', 'failure-analyst']);
    assert.match(solo, /Orchestration Mode: Solo/);
    assert.match(solo, /Exception: the basic role agents/);
    assert.match(solo, /failure-analyst \(failure-analyst\): failure-analyst condition/);
    assert.doesNotMatch(context('none', ['advisor']), /Exception/);
    assert.equal(context('none', []), '');
    assert.doesNotMatch(context('swarm', ['failure-analyst']), /Exception/);
    for (const id of SOLO_BASIC_ROLE_IDS) {
        assert.ok(BUILTIN_AGENTS.some((agent) => agent.id === id), id);
        assert.ok(isBasicAgent({ id }), id);
    }
    // 예외 문단만 남은 부분 적용은 거부한다.
    const [first, , third] = spec.edits;
    const partial = installed.replace(first[1], first[0]).replace(third[0], third[1]);
    assert.throws(() => patchedAgentSource(partial, spec), /Partial|hash mismatch/);
});
