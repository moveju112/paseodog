import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scratchPath } from '../scripts/paths.mjs';
import { waitForUpdaterVerification } from '../scripts/release-pipeline.mjs';

async function fixture(t, phase = 'applied') {
    const root = await mkdtemp(scratchPath('paseodog-verifier-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const receipt = { phase, revision: 'a'.repeat(40) };
    await writeFile(join(root, 'receipt.json'), JSON.stringify(receipt));
    return { root, receipt };
}

test('applied waits for all post-update services to stop, including cleanup', async t => {
    const { root, receipt } = await fixture(t);
    let sleeps = 0;
    const seen = [];
    const capture = async (_command, args) => {
        if (args.includes('--property=OnSuccess')) return 'verify.service cleanup.service\n';
        seen.push(args[2]);
        return `ActiveState=${args[2] === 'cleanup.service' && sleeps < 2 ? 'activating' : 'inactive'}\nResult=success\n`;
    };
    assert.deepEqual(await waitForUpdaterVerification(root, 'update.service', capture, {
        sleep: async () => { sleeps++; },
    }), receipt);
    assert.equal(sleeps, 2);
    assert.deepEqual(new Set(seen), new Set(['verify.service', 'cleanup.service']));
});

test('idle service without applied receipt times out instead of claiming success', async t => {
    const { root } = await fixture(t, 'awaiting-verification');
    let elapsed = 0;
    await assert.rejects(waitForUpdaterVerification(root, 'update.service', async (_command, args) =>
        args.includes('--property=OnSuccess') ? 'verify.service' : 'ActiveState=inactive\nResult=success\n', {
        timeoutMs: 4000, now: () => elapsed, sleep: async ms => { elapsed += ms; },
    }), /timeout/);
    assert.equal(elapsed, 4000);
});

test('cleanup that never releases its service times out even with applied receipt', async t => {
    const { root } = await fixture(t);
    let elapsed = 0;
    await assert.rejects(waitForUpdaterVerification(root, 'update.service', async (_command, args) =>
        args.includes('--property=OnSuccess') ? 'verify.service' : 'ActiveState=activating\nResult=success\n', {
        timeoutMs: 4000, now: () => elapsed, sleep: async ms => { elapsed += ms; },
    }), /timeout/);
});

for (const status of ['ActiveState=failed\nResult=exit-code', 'ActiveState=inactive\nResult=exit-code', '']) {
    test(`verification does not hide an unsuccessful or missing service: ${JSON.stringify(status)}`, async t => {
        const { root } = await fixture(t);
        await assert.rejects(waitForUpdaterVerification(root, 'update.service', async (_command, args) =>
            args.includes('--property=OnSuccess') ? 'verify.service' : status), /did not succeed/);
    });
}

test('missing post-update service, rollback and query failures are not success', async t => {
    const { root } = await fixture(t, 'rolled-back');
    await assert.rejects(waitForUpdaterVerification(root, 'update.service', async () => ''), /no post-update/);
    await assert.rejects(waitForUpdaterVerification(root, 'update.service', async () => 'verify.service'), /rolled-back/);
    await assert.rejects(waitForUpdaterVerification(root, 'update.service', async () => {
        throw new Error('systemctl unavailable');
    }), /systemctl unavailable/);
});
