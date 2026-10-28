import test from 'node:test';
import assert from 'node:assert/strict';
import { installEngine } from '../scripts/install-engine.mjs';

test('engine install finishes child hooks before the parent prune hook', async () => {
    const calls = [];
    let running = false;
    await installEngine(async (command, args) => {
        assert.equal(running, false);
        running = true;
        await new Promise(resolve => setImmediate(resolve));
        calls.push([command, ...args]);
        running = false;
    });
    assert.deepEqual(calls[0], ['npm', '--prefix', 'engine', 'ci', '--install-strategy=nested', '--ignore-scripts']);
    assert.equal(calls.length, 5);
    assert.ok(calls[1][2].endsWith('/protobufjs'));
    assert.ok(calls[2][2].endsWith('/onnxruntime-node'));
    assert.ok(calls[3][2].endsWith('/tesseract.js'));
    assert.deepEqual(calls[4], ['npm', '--prefix', 'engine/node_modules/mixdog', 'run', 'postinstall']);
});

test('failed child hook stops engine installation without running the parent', async () => {
    let calls = 0;
    const failure = new Error('child hook failed');
    await assert.rejects(installEngine(async () => {
        if (++calls === 2) throw failure;
    }), error => error === failure);
    assert.equal(calls, 2);
});
