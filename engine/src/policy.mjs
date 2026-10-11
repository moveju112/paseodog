// Tool-policy guard, not an OS sandbox. Shell approval authorizes its whole command.
import { createHash } from 'node:crypto';
const READ_TOOLS = new Set(['read', 'head', 'tail', 'grep', 'glob', 'list', 'tree', 'find_files', 'diff', 'code_graph']);
const FORBIDDEN = /^(agent|agents|task|task_control|automation|schedule|scheduler|channel|channels|setup|computer|goal)$/i;
const MARKER = Symbol('paseodog-policy');
const PROMPT_TAG = 'paseodog_host_prompt_v1';
export function mapMcpServers(servers = {}) {
    const out = Object.create(null);
    for (const [name, cfg] of Object.entries(servers)) {
        if (!cfg || ['__proto__', 'constructor', 'prototype'].includes(name) || !/^[\w.-]+$/.test(name)) throw new Error('Invalid MCP server');
        if (cfg.type === 'stdio') {
            if (typeof cfg.command !== 'string' || !cfg.command.trim()) throw new Error(`Missing MCP command: ${name}`);
            if (cfg.args && (!Array.isArray(cfg.args) || cfg.args.some((x) => typeof x !== 'string'))) throw new Error('Invalid MCP args');
            out[name] = { type: 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env || {} };
        } else if (cfg.type === 'http' || cfg.type === 'sse') {
            const url = new URL(cfg.url);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid MCP URL');
            out[name] = { type: cfg.type, url: cfg.url, headers: cfg.headers || {} };
        } else throw new Error(`Unsupported MCP transport: ${cfg.type}`);
    }
    return out;
}
export function attachHostPolicy(session, { mode = 'ask', systemPrompt = '', onIdentity }) {
    if (!session?.id || !Array.isArray(session.messages)) throw new Error('Mixdog session contract mismatch');
    if (!['ask', 'review'].includes(mode)) throw new Error('Invalid host mode');
    // Explicit app-level instructions stay stable. Never silently change an established prefix.
    const existing = session.messages.find((m) => m[PROMPT_TAG]);
    if (existing && existing.content !== systemPrompt) throw new Error('Host system prompt changed; start a new session');
    if (systemPrompt && !existing) {
        const entry = { role: 'system', content: systemPrompt, [PROMPT_TAG]: true };
        const index = session.messages.findIndex((m) => m.role !== 'system');
        session.messages.splice(index < 0 ? session.messages.length : index, 0, entry);
        // A changed transcript prefix cannot reuse an old provider continuation.
        session.providerState = undefined;
    }
    const prior = session.beforeToolHook && Object.hasOwn(session.beforeToolHook, MARKER) ? session.beforeToolHook[MARKER] : session.beforeToolHook;
    const wrapped = async (input, options) => {
        const decision = prior ? await prior(input, options) : null;
        const action = String(decision?.action || decision?.decision || '').toLowerCase();
        if (action === 'deny' || action === 'block') return decision;
        const rewritten = ['ask', 'modify', 'rewrite'].includes(action);
        const name = rewritten && decision?.name ? decision.name : input.name;
        const args = rewritten && decision?.args ? decision.args : input.args;
        if (FORBIDDEN.test(name)) return { action: 'deny', reason: 'Delegation, automation, configuration mutation and desktop control are disabled in PaseoDog' };
        if (mode === 'review' && !READ_TOOLS.has(String(name).toLowerCase())) return { action: 'deny', reason: 'Review mode permits only the explicit read-tool allowlist' };
        const fingerprint = createHash('sha256').update(JSON.stringify({ name, args })).digest('hex').slice(0, 16);
        // Always ask, including on read tools: upstream annotation is not authorization.
        return { ...decision, name, args, action: 'ask', reason: `${decision?.reason ? decision.reason + '\n' : ''}PaseoDog allow-once approval (${fingerprint})` };
    };
    Object.defineProperty(wrapped, MARKER, { value: prior || null });
    Object.defineProperty(session, 'beforeToolHook', { value: wrapped, writable: true, configurable: true, enumerable: false });
    onIdentity?.(session.id, { provider: session.provider, model: session.model, effort: session.effort, cwd: session.cwd });
}
