import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createConfigLifecycle, flushPendingSessionConfigWrites } from '../engine/node_modules/mixdog/src/session-runtime/config-lifecycle.mjs';
import { createProfileSettings } from '../engine/node_modules/mixdog/src/session-runtime/settings-profile-api.mjs';
import profileConfig from '../engine/node_modules/mixdog/src/runtime/shared/profile-config.cjs';
import { diffConfig, applyConfigPatch } from '../engine/node_modules/mixdog/src/runtime/shared/config-patch.mjs';
import { fixture, until } from './helpers.mjs';

test('native config reload preserves saved and peer settings instead of boot defaults', async () => {
    const initial = { builtins: {}, profile: { experienceLevel: 'beginner' }, mcpServers: {},
        update: { auto: false }, default: { effort: 'low' } };
    let disk = structuredClone(initial), current = structuredClone(initial);
    const cfgMod = {
        ...profileConfig,
        loadConfig: () => structuredClone(disk),
        createConfigPatch: diffConfig,
        saveConfigPatch(changes) { disk = applyConfigPatch(disk, changes); },
        async saveConfigPatchAsync(changes) { disk = applyConfigPatch(disk, changes); },
    };
    const source = readFileSync(new URL('../engine/node_modules/mixdog/src/session-runtime/boot/providers.mjs', import.meta.url), 'utf8');
    const expression = source.match(/\n    cfgMod: (.+),\n    sharedCfgMod,/)[1];
    const liveModule = new Function('cfgMod', 'boot', `return (${expression});`)(cfgMod, { params: { initialConfig: initial } });
    const lifecycle = createConfigLifecycle({
        getConfig: () => current, setConfig: (next) => { current = next; },
        getWebSearchRoute: () => ({}), setWebSearchRoute() {},
        getConfigHasSecrets: () => true, setConfigHasSecrets() {},
        getRoute: () => ({}), cfgMod: liveModule,
        sharedCfgMod: { pendingConfigWrites: async () => {} },
        setConfiguredShell() {}, normalizeSystemShellConfig: () => ({}),
        normalizeWebSearchRouteConfig: (value) => value,
        outputStyleStatus: () => ({}), LAZY_SECRET_PROVIDERS: new Set(),
        clean: (value) => String(value || ''), resolve: (...parts) => parts.join('/'), STANDALONE_DATA_DIR: '/tmp',
    });
    const settings = createProfileSettings({
        getConfig: () => current, ...lifecycle, cfgMod: liveModule,
        hasOwn: Object.hasOwn, summarizeWorkflowRoutes: () => [], ONBOARDING_VERSION: 1,
    });
    for (const experienceLevel of ['expert', 'senior', '']) {
        settings.setProfile({ experienceLevel });
        await flushPendingSessionConfigWrites();
        lifecycle.reloadFullConfig();
        assert.equal(settings.getProfile().experienceLevel, experienceLevel);
        assert.equal(disk.profile.experienceLevel, experienceLevel);
    }
    disk = { ...disk, default: { effort: 'high' }, instructionFiles: 'claude',
        workflow: { active: 'none' }, orchestrationMode: 'swarm', compaction: { auto: false },
        autoClear: { enabled: false }, worktree: { newTaskDefault: 'direct' },
        skills: { disabled: [] }, mcpServers: { unexpected: {} }, update: { auto: true, channel: 'stable' },
        promptCacheWarming: true };
    lifecycle.reloadFullConfig();
    for (const key of ['default', 'instructionFiles', 'workflow', 'orchestrationMode', 'compaction', 'autoClear', 'worktree', 'skills'])
        assert.deepEqual(current[key], disk[key], key);
    assert.deepEqual(current.mcpServers, {});
    assert.equal(current.update.auto, false);
    assert.equal(current.update.channel, 'stable');
    assert.equal(current.promptCacheWarming, false);
    assert.equal(disk.promptCacheWarming, true);
    lifecycle.disposeConfigSync();
});

test('selected effort and catalog survive identity updates and mode changes', async (t) => {
    const f = fixture({
        async configure() {},
        async ask(text, callbacks) {
            callbacks.onIdentity({ id: 'sess_test', state: { provider: 'p', model: 'm', effort: 'low' } });
            return { content: 'done' };
        },
    }, { loadCatalog: async () => ({
        route: { provider: 'p', model: 'm', effort: 'low' },
        models: [{ provider: 'p', id: 'm', label: 'Model', effortOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }],
    }) });
    t.after(() => f.connection.close());
    f.open.config.model = 'p/m';
    f.open.config.thinkingOption = 'high';
    await f.ready();
    await f.run();
    await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId: 'mode', changes: { mode: 'bypass' } });
    await until(f.events, (event) => event.type === 'request.completed' && event.requestId === 'mode');
    assert.equal(f.creates[0].route.effort, 'high');
    for (const event of f.events.filter((event) => event.type === 'session.config')) {
        assert.equal(event.config.thinkingOption, 'high');
        assert.ok(event.config.models.some((model) => model.id === 'p/m'));
        assert.deepEqual(event.config.thinkingOptions.map((option) => option.id), ['low', 'high']);
    }
});
