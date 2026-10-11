import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { attachHostPolicy, mapMcpServers } from './policy.mjs';
import { patch } from '../../scripts/patch-mixdog.mjs';

export async function loadNativeModules() {
    const runtimeUrl = import.meta.resolve('mixdog/src/mixdog-session-runtime.mjs');
    const root = resolve(dirname(fileURLToPath(runtimeUrl)), '..');
    patch(root, { check: true });
    const [{ createMixdogSessionRuntime }, cfg] = await Promise.all([
        import(runtimeUrl), import('mixdog/src/runtime/agent/orchestrator/config.mjs'),
    ]);
    if (typeof createMixdogSessionRuntime !== 'function' || typeof cfg.loadConfig !== 'function') throw new Error('Mixdog native API mismatch');
    return { createMixdogSessionRuntime, loadConfig: () => cfg.loadConfig({ secrets: true }), root };
}
export async function createNativeEngine(args, { modules, emit = () => {} } = {}) {
    const native = modules || await loadNativeModules();
    const baseConfig = await native.loadConfig();
    const config = args.config;
    const route = args.route || {};
    // Only the explicitly supplied MCP servers are visible in this host. Do not
    // inherit hidden servers from another app profile. Auth/model settings stay local.
    const initialConfig = { ...baseConfig, mcpServers: mapMcpServers(config.mcpServers) };
    const runtime = await native.createMixdogSessionRuntime({
        cwd: config.cwd, provider: route.provider, model: route.model,
        effort: route.effort, toolMode: config.mode === 'review' ? 'readonly' : 'full',
        approvalMode: null, disallowDelegation: true, autoWakeCompletions: false,
        initialConfig,
    });
    for (const name of ['ask', 'abort', 'close', 'resume', 'compact']) {
        if (typeof runtime[name] !== 'function') {
            await runtime.close?.('paseodog-contract-failure');
            throw new Error(`Mixdog runtime missing ${name}`);
        }
    }
    let closed = false;
    try {
        if (args.nativeSessionId) {
            const resumed = await runtime.resume(args.nativeSessionId);
            if (runtime.session?.remoteAttached === true) throw new Error('Native session is owned by another live Mixdog process; close that writer before attaching');
            if (!resumed || resumed.id !== args.nativeSessionId) throw new Error('Native session not found; refusing a blank replacement');
            if (resolve(resumed.cwd) !== resolve(config.cwd)) throw new Error('Native session cwd differs from Paseo workspace');
            // A journal/session-file mismatch must fail BEFORE any model inference.
            // Effort may change independently through Mixdog automatic reasoning, so do not pin it.
            for (const field of ['provider', 'model']) {
                if (route[field] !== undefined && resumed[field] !== route[field]) {
                    throw new Error(`Native session ${field} differs from the saved model route`);
                }
            }
        }
    } catch (error) { await runtime.close('paseodog-resume-failed'); throw error; }
    return {
        get id() { return runtime.id || ''; },
        async ask(text, callbacks) {
            if (closed) throw new Error('Native engine closed');
            if (runtime.session?.remoteAttached === true) throw new Error('Refusing to forward work to an unmanaged native writer');
            return runtime.ask(text, {
                ...callbacks,
                beforeSessionAsk(session) {
                    attachHostPolicy(session, { mode: config.mode || 'ask', systemPrompt: config.systemPrompt || '',
                        onIdentity: (id, state) => callbacks.onIdentity?.({ id, state }) });
                },
            });
        },
        async compact() {
            const counters = () => {
                const session = runtime.session || {};
                return { deltaInput: Number(session.totalInputTokens) || 0,
                    deltaOutput: Number(session.totalOutputTokens) || 0,
                    deltaCachedRead: Number(session.totalCachedReadTokens) || 0,
                    deltaCacheWrite: Number(session.totalCacheWriteTokens) || 0 };
            };
            const before = counters();
            const result = await runtime.compact({ requireReduction: true });
            const after = counters();
            const usageDelta = Object.fromEntries(Object.keys(before).map((key) =>
                [key, Math.max(0, after[key] - before[key])]));
            return { ...result, usageDelta };
        },
        abort: (reason) => runtime.abort(reason),
        async close(reason) { if (closed) return; closed = true; await runtime.close(reason); },
    };
}
