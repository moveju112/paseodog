import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveMonitor } from '../plugin/client/live-monitor.mjs';
import { deferred } from './helpers.mjs';

test('live status waits for each response, reports changes and stops on unmount', async () => {
    const scheduled = new Set(), values = [], errors = [], pending = [];
    const monitor = createLiveMonitor({
        read: () => { const request = deferred(); pending.push(request); return request.promise; },
        onValue: (value) => values.push(value), onError: (error) => errors.push(error.message),
        schedule: (callback) => { scheduled.add(callback); return callback; },
        cancel: (callback) => scheduled.delete(callback),
    });
    monitor.setActive(true);
    monitor.setActive(true);
    assert.equal(pending.length, 1);
    assert.equal(scheduled.size, 0);
    pending[0].resolve({ state: 'running' });
    await Promise.resolve();
    assert.deepEqual(values, [{ state: 'running' }]);
    assert.equal(scheduled.size, 1);
    const next = [...scheduled][0];
    scheduled.delete(next);
    const completion = next();
    pending[1].resolve({ state: 'completed' });
    await completion;
    assert.equal(values.at(-1).state, 'completed');
    monitor.setActive(false);
    assert.equal(scheduled.size, 0);
    monitor.setActive(true);
    pending[2].reject(new Error('disconnected'));
    await Promise.resolve();
    assert.deepEqual(errors, ['disconnected']);
    monitor.setActive(true);
    assert.equal(pending.length, 4);
    monitor.stop();
    pending[3].resolve({ state: 'stale' });
    await Promise.resolve();
    assert.equal(values.at(-1).state, 'completed');
    assert.equal(scheduled.size, 0);
});
