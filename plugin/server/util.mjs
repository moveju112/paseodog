import { createHash } from 'node:crypto';

export const VERSION = '1.0.0-rc.3';
export const DEFAULT_MODEL = 'mixdog-default';
export const MAX_FRAME = 2 * 1024 * 1024;
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
    if (config.mode && !['ask', 'review'].includes(config.mode)) throw new Error(`Unsupported mode: ${config.mode}`);
    if (typeof config.persist !== 'boolean') throw new Error('persist must be boolean');
    if (Object.keys(config.settings).length) throw new Error(`Unsupported session settings: ${Object.keys(config.settings).join(', ')}`);
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
    if (prompt.delivery === 'steer') throw new Error('Steering is not supported; interrupt then send a new message');
    if (!['auto', undefined].includes(prompt.delivery)) throw new Error('Invalid prompt delivery');
    if (typeof prompt.clientMessageId !== 'string' || !prompt.clientMessageId || prompt.clientMessageId.length > 200) {
        throw new Error('Invalid clientMessageId');
    }
    if (prompt.input?.type === 'command') {
        if (prompt.input.name !== 'compact' || String(prompt.input.arguments || '').trim()) throw new Error('Only /compact without arguments is supported');
        return { command: 'compact' };
    }
    const content = prompt.input?.content;
    if (prompt.input?.type !== 'message' || !Array.isArray(content) || !content.length) throw new Error('Text message required');
    if (content.some((part) => part?.type !== 'text' || typeof part.text !== 'string')) {
        throw new Error('Only text is supported. Images and file attachments are not silently discarded.');
    }
    const text = content.map((part) => part.text).join('\n');
    if (!text.trim() || Buffer.byteLength(text) > 512 * 1024) throw new Error('Empty or oversized prompt');
    return { text };
}
