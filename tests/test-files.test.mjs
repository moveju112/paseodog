import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { scratchPath } from '../scripts/paths.mjs';
import { join } from 'node:path';
import { runTestFiles } from '../scripts/test-files.mjs';

test('test receipts reuse successes, rerun failures and invalidate changed inputs', async t => {
    const directory = await mkdtemp(scratchPath('paseodog-test-receipt-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = ['first', 'second'].map(name => join(directory, name));
    await Promise.all(files.map(path => writeFile(path, 'fixture')));
    const calls = [];
    let fail = true;
    const execute = async file => { calls.push(file); return file === files[1] && fail ? 1 : 0; };
    const options = { cache: join(directory, 'cache'), identity: 'same-source' };
    assert.equal(await runTestFiles(files, execute, options), 1);
    fail = false;
    assert.equal(await runTestFiles(files, execute, options), 0);
    assert.equal(calls.filter(file => file === files[0]).length, 1);
    assert.equal(calls.filter(file => file === files[1]).length, 2);
    await writeFile(files[0], 'changed');
    await runTestFiles(files, execute, options);
    assert.equal(calls.at(-1), files[0]);
    const before = calls.length;
    await runTestFiles(files, execute, { ...options, identity: 'new-source' });
    assert.equal(calls.length, before + 2);
});

test('changed source never produces reusable test receipts', async t => {
    const directory = await mkdtemp(scratchPath('paseodog-test-drift-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'input'); await writeFile(file, 'fixture');
    let calls = 0;
    const execute = async () => { calls++; return 0; };
    const options = { cache: join(directory, 'cache'), identity: 'source' };
    await assert.rejects(runTestFiles([file], execute, { ...options, validate: async () => false }), /Source changed/);
    await runTestFiles([file], execute, options);
    assert.equal(calls, 2);
});
