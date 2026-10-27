import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeb } from '../scripts/build-web.mjs';

test('server web export builds shared dependencies and browser UI without a hosting prefix', async () => {
    const calls = [];
    await buildWeb({ output: '/data/tmp/ubuntu/server-web-test', hosting: 'server', metroWorkers: '1' },
        async (command, args, options) => calls.push({ command, args, options }));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, 'npm');
    assert.deepEqual(calls[0].args, ['run', 'build:app-deps']);
    assert.equal(calls[1].command, 'npx');
    assert.deepEqual(calls[1].args, ['expo', 'export', '--platform', 'web', '--output-dir',
        '/data/tmp/ubuntu/server-web-test', '--max-workers', '1']);
    assert.equal(calls[1].options.env.PASEO_WEB_PLATFORM, '');
    assert.equal(calls[1].options.env.PASEODOG_WEB_BASE_PATH, '');
    assert.equal(calls[1].options.env.APP_VARIANT, 'production');
});

test('server web export propagates build failures without exporting stale dependencies', async () => {
    let calls = 0;
    await assert.rejects(buildWeb({ output: '/data/tmp/ubuntu/server-web-test', hosting: 'server' },
        async () => { calls++; throw new Error('dependency build failed'); }), /dependency build failed/);
    assert.equal(calls, 1);
});
