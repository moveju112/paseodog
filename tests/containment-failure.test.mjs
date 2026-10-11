import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until, delay, deferred } from './helpers.mjs';

/**
 * Inject disk-full only after an accepted turn's receipt has been stored. A
 * rejected native kill, synchronous throw, or hung systemd stop must never
 * become an unhandled rejection that tears down unrelated provider sessions.
 */
async function scenario(mode) {
    const gate = deferred();
    let kills = 0;
    const engine = {
        async ask(_text, callbacks) {
            callbacks.onTextDelta('partial');
            return gate.promise;
        },
        kill() {
            kills++;
            if (mode === 'reject') return Promise.reject(new Error('user bus unavailable'));
            if (mode === 'throw') throw new Error('systemd unavailable');
            if (mode === 'hang') return new Promise(() => {});
            return Promise.resolve();
        },
    };
    const f = fixture(engine, { flushMs: 3, stopMs: 15, maxTurnMs: 2000 });
    const save = f.store.save.bind(f.store);
    try {
        await f.ready();
        let saves = 0;
        f.store.save = (record) => {
            if (++saves >= 2) throw new Error('ENOSPC');
            return save(record);
        };
        await f.connection.send(f.prompt);
        await until(f.events, (event) => event.type === 'session.turn' && event.state === 'started');
        await until(f.events, (event) => event.type === 'session.runtime_failed');
        await until(f.events, (event) => event.type === 'session.notice'
            && event.notice.id === (mode === 'success' ? 'containment-confirmed' : 'containment-unconfirmed'));
        const notice = f.events.findLast((event) => event.type === 'session.notice');
        assert.equal(kills, 1);
        assert.equal(f.events.filter((event) => event.type === 'session.runtime_failed').length, 1);
        assert.equal(f.events.filter((event) => event.type === 'session.turn' && event.state === 'failed').length, 1);
        if (mode !== 'success') assert.match(notice.notice.title, /Unable to confirm Mixdog process termination/);
        // No accepted request should be silently replayed while containment is
        // unresolved. The same connection should remain responsive.
        await f.connection.send({ ...f.prompt, prompt: { ...f.prompt.prompt, clientMessageId: 'next' } });
        const rejected = await until(f.events, (event) => event.type === 'session.prompt_result'
            && event.clientMessageId === 'next');
        assert.equal(rejected.result.type, 'failed');
        // The previous turn's receipt stays running, allowing recover/open to
        // classify the uncertain execution without claiming clean rollback.
        assert.ok(f.store.list().some((r) => r.active?.receiptKey));
        f.store.save = save;
        await f.connection.send({ ...f.open, requestId: 'independent-open', sessionId: 'p2' });
        await until(f.events, (event) => event.type === 'session.ready' && event.sessionId === 'p2');
        assert.equal(f.events.some((event) => event.type === 'session.runtime_failed' && event.sessionId === 'p2'), false);
    } finally {
        f.store.save = save;
        gate.resolve({ content: 'late-finish' });
        await delay(3);
        await f.connection.close();
    }
}
for (const mode of ['reject', 'throw', 'hang', 'success']) {
    test(`journal failure -> ${mode} native scope shutdown remains contained`, async () => scenario(mode));
}
