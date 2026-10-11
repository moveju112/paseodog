import { validateEvent } from './contracts/provider-events.mjs';
import { createProviderConnection, CAPABILITIES } from '../plugin/server/connection.mjs';
import { MemoryJournalStore } from '../plugin/server/journal.mjs';
export const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
export function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; }
export async function until(events, predicate, timeout = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const event = events.find(predicate); if (event) return event;
        await delay(2);
    }
    throw new Error(`Timed out: ${JSON.stringify(events).slice(-5000)}`);
}
export function fixture(overrides = {}, options = {}) {
    const events = [], calls = [], creates = [];
    const engine = { id: 'sess_test',
        async ask(text, callbacks) {
            calls.push({ text, callbacks }); callbacks.onIdentity?.({ id: 'sess_test', state: { model: 'test-model' } });
            callbacks.onTextDelta?.('hello'); callbacks.onTextDelta?.(' world');
            callbacks.onUsageDelta?.({ deltaInput: 12, deltaCachedRead: 2, deltaOutput: 3, deltaCacheWrite: 1 });
            return { result: { content: 'hello world' } };
        }, async compact() { calls.push({ compact: true }); return { changed: true }; },
        abort() { calls.push({ abort: true }); }, async close() { calls.push({ close: true }); }, kill() { calls.push({ kill: true }); }, ...overrides };
    const store = options.store || new MemoryJournalStore();
    const connection = createProviderConnection({ capabilities: CAPABILITIES, store, canonicalPath: (x) => x,
        stopMs: 30, bootMs: 100, permissionMs: 50, flushMs: 5, maxTurnMs: 1000,
        engineFactory: { async create(args) { creates.push(args); return engine; } }, ...options });
    connection.onEvent((e) => events.push(e));
    const close = connection.close.bind(connection);
    connection.close = async () => { await close(); for (const e of events) validateEvent(e); };
    const open = { type: 'session.open', requestId: 'open1', sessionId: 'p1', history: 'skip',
        config: { cwd: '/work', env: {}, mcpServers: {}, settings: {}, persist: true, model: 'mixdog-default' } };
    const prompt = { type: 'session.prompt', sessionId: 'p1', prompt: { clientMessageId: 'm1', delivery: 'auto', input: { type: 'message', content: [{ type: 'text', text: 'fix code' }] } } };
    return { connection, store, events, calls, creates, engine, open, prompt,
        async ready() { await connection.send(open); await until(events, (e) => e.type === 'session.ready'); },
        async run(p = prompt) { await connection.send(p); return until(events, (e) => e.type === 'session.turn' && e.state !== 'started'); },
    };
}
export const terminal = (events) => events.filter((e) => e.type === 'session.turn' && e.state !== 'started');
