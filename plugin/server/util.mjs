import { createHash } from 'node:crypto';
import release from '../shared/release.json' with { type: 'json' };

export const VERSION = release.version;
export const UPSTREAM_VERSIONS = release.paseodogUpstream;
export const DEFAULT_MODEL = 'mixdog-default';
export const MAX_FRAME = 16 * 1024 * 1024;
export const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function errorText(error) {
    return String(error?.message || error || 'Unknown error').slice(0, 4000);
}
export function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}
export function hash(value) {
    return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
export function textOf(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter((x) => x?.type === 'text').map((x) => x.text || '').join('\n');
    return '';
}
export function display(value, max = 16384) {
    let result;
    try { result = typeof value === 'string' ? value : JSON.stringify(value ?? null); }
    catch { result = '[Unserializable tool output]'; }
    return result.length > max ? `${result.slice(0, max)}\n[UI preview truncated; original retained by Mixdog]` : result;
}
export function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
export async function deadline(promise, ms, message = 'Operation timed out') {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        })]);
    } finally { clearTimeout(timer); }
}
export function tokenUsage(delta, previous = {}) {
    return {
        inputTokens: finite(previous.inputTokens) + finite(delta?.deltaInput),
        cachedInputTokens: finite(previous.cachedInputTokens) + finite(delta?.deltaCachedRead),
        outputTokens: finite(previous.outputTokens) + finite(delta?.deltaOutput),
        // Paseo has no cache-write field. It is retained in the audit journal.
        cacheWriteTokens: finite(previous.cacheWriteTokens) + finite(delta?.deltaCacheWrite),
    };
}
export function publicUsage(value) {
    const { inputTokens, cachedInputTokens, outputTokens } = value;
    return { inputTokens, cachedInputTokens, outputTokens };
}
// 누적 토큰과 분리된 Mixdog의 현재 컨텍스트 수치만 Paseo 필드로 매핑한다.
export function contextUsage(context = {}) {
    const result = {};
    const maximum = context.effectiveContextWindow ?? context.contextWindow;
    if (typeof maximum === 'number' && Number.isFinite(maximum) && maximum > 0)
        result.contextWindowMaxTokens = maximum;
    if (typeof context.usedTokens === 'number' && Number.isFinite(context.usedTokens) && context.usedTokens >= 0)
        result.contextWindowUsedTokens = context.usedTokens;
    return result;
}
export function safeKey(value, name = 'identifier') {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error(`Invalid ${name}`);
    return value;
}
export function validateConfig(config) {
    if (!plainObject(config) || typeof config.cwd !== 'string' || !config.cwd || config.cwd.includes('\0')) {
        throw new Error('An absolute working directory is required');
    }
    for (const field of ['env', 'mcpServers', 'settings']) {
        if (!plainObject(config[field])) throw new Error(`Invalid session ${field}`);
    }
    if (config.toolPolicy?.preapproved?.length) throw new Error('Exact MCP preapproval is unsupported; unattended launch denied');
    if (config.systemPrompt !== undefined && (typeof config.systemPrompt !== 'string' || config.systemPrompt.length > 131072)) {
        throw new Error('Invalid or oversized system prompt');
    }
    if (config.mode && !['ask', 'review', 'bypass'].includes(config.mode)) throw new Error(`Unsupported mode: ${config.mode}`);
    if (typeof config.persist !== 'boolean') throw new Error('persist must be boolean');
    if (Object.keys(config.settings).some((key) => key !== 'autoEffort')
        || (Object.hasOwn(config.settings, 'autoEffort') && typeof config.settings.autoEffort !== 'boolean'))
        throw new Error('Unsupported session settings; autoEffort must be boolean');
    for (const [key, value] of Object.entries(config.env)) {
        if (typeof value !== 'string' || key.includes('\0') || key.includes('=') || value.includes('\0')) {
            throw new Error('Invalid environment variable');
        }
        // Configuration and identity belong to the daemon, never to the target workspace.
        if (['NODE_OPTIONS', 'NODE_PATH', 'PASEO_HOME', 'MIXDOG_HOME', 'MIXDOG_DATA_DIR'].includes(key) || key.startsWith('PASEODOG_')) {
            throw new Error(`Reserved environment variable: ${key}`);
        }
    }
    const options = config.providerOptions || {};
    if (!plainObject(options)) throw new Error('providerOptions must be an object');
    const allowed = new Set(['provider', 'model', 'effort']);
    for (const key of Object.keys(options)) {
        if (!allowed.has(key)) throw new Error(`Unsupported provider option: ${key}`);
        if (typeof options[key] !== 'string' || options[key].length > 256) throw new Error(`Invalid provider option: ${key}`);
    }
    if (config.thinkingOption && typeof config.thinkingOption !== 'string') throw new Error('Invalid thinking option');
    return config;
}
export function promptText(prompt) {
    if (prompt.outputSchema !== undefined) throw new Error('Structured output is not supported by this bridge');
    if (!['auto', 'steer', undefined].includes(prompt.delivery)) throw new Error('Invalid prompt delivery');
    if (typeof prompt.clientMessageId !== 'string' || !prompt.clientMessageId || prompt.clientMessageId.length > 200) {
        throw new Error('Invalid clientMessageId');
    }
    if (prompt.input?.type === 'command') {
        if (prompt.input.name !== 'compact' || String(prompt.input.arguments || '').trim()) throw new Error('Only /compact without arguments is supported');
        return { command: 'compact' };
    }
    const content = prompt.input?.content;
    if (prompt.input?.type !== 'message' || !Array.isArray(content) || !content.length) throw new Error('Text message required');
    const parts = content.map((part) => {
        if (part?.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
        if (part?.type !== 'image') throw new Error('Only text and images are supported; unsupported attachments are not discarded.');
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(part.mimeType)
            || typeof part.data !== 'string' || !part.data.length
            || part.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data))
            throw new Error('Invalid image MIME type or base64 data');
        return { type: 'image', data: part.data, mimeType: part.mimeType };
    });
    const text = parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const hasImages = parts.some((part) => part.type === 'image');
    if ((!text.trim() && !hasImages) || Buffer.byteLength(text) > 512 * 1024) throw new Error('Empty or oversized prompt');
    if (Buffer.byteLength(JSON.stringify(parts)) > MAX_FRAME - 64 * 1024)
        throw new Error('Image prompt exceeds the 16 MiB IPC limit');
    return hasImages ? { text, content: parts } : { text };
}
