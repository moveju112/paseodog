// Tool-policy guard, not an OS sandbox. Shell approval authorizes its whole command.
import { createHash } from 'node:crypto';
import { SOLO_BASIC_ROLE_IDS } from '../../patches/builtin-agents.mjs';
const READ_TOOLS = new Set(['read', 'head', 'tail', 'grep', 'glob', 'list', 'tree', 'find', 'find_files', 'diff', 'code_graph']);
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
export function attachHostPolicy(session, { mode = 'ask', systemPrompt = '', onIdentity, orchestration = false }) {
    if (!session?.id || !Array.isArray(session.messages)) throw new Error('Mixdog session contract mismatch');
    if (!['ask', 'review', 'bypass'].includes(mode)) throw new Error('Invalid host mode');
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
        const agentTool = ['agent', 'task'].includes(String(name).toLowerCase());
        // 단독 모드도 기본 역할 spawn은 협업 모드의 위임과 같은 정책으로 처리한다.
        const managed = agentTool && (orchestration || (args?.type === 'spawn' && SOLO_BASIC_ROLE_IDS.includes(args?.agent)));
        if (managed && (args?.allTerminals || args?.global || args?.recover))
            return { action: 'deny', reason: 'Cross-session agent control is disabled in PaseoDog' };
        if (mode === 'review' && !managed && !READ_TOOLS.has(String(name).toLowerCase())) return { action: 'deny', reason: 'Review mode permits only the explicit read-tool allowlist' };
        // Bypass는 명시적 차단을 유지하고 최종 도구·인자를 승인 질문 없이 전달한다.
        if (mode === 'bypass') return { ...decision, name, args, action: 'rewrite' };
        const fingerprint = createHash('sha256').update(JSON.stringify({ name, args })).digest('hex').slice(0, 16);
        // Ask와 Review에서는 읽기 도구도 매번 승인을 받는다.
        return { ...decision, name, args, action: 'ask', reason: `${decision?.reason ? decision.reason + '\n' : ''}PaseoDog allow-once approval (${fingerprint})` };
    };
    Object.defineProperty(wrapped, MARKER, { value: prior || null });
    Object.defineProperty(session, 'beforeToolHook', { value: wrapped, writable: true, configurable: true, enumerable: false });
    onIdentity?.(session.id, { provider: session.provider, model: session.model, effort: session.effort, cwd: session.cwd });
}
