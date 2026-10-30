import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchPushNotifications, pushNotificationSources, PUSH_FILE, TAG_FILE, PUSH_BLOB } from '../scripts/patch-paseo-push-notifications.mjs';
import { gitBlob } from '../scripts/patch-mixdog.mjs';
import { scratchPath } from '../scripts/paths.mjs';

async function fixture(t) {
    const root = await mkdtemp(scratchPath('paseodog-push-patch-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    // 원본 npm JS는 마지막 개행이 없다. 텍스트 fixture의 마지막 LF 하나만 제거해 원본 blob을 재현한다.
    const fixtureText = await readFile(new URL('./fixtures/paseo-push-service.js', import.meta.url), 'utf8');
    assert.ok(fixtureText.endsWith('\n'));
    const source = fixtureText.slice(0, -1);
    assert.equal(gitBlob(source), PUSH_BLOB);
    await mkdir(dirname(join(root, PUSH_FILE)), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '0.11.4' }));
    await writeFile(join(root, PUSH_FILE), source);
    return { root, source };
}

test('push patch checks are read-only, apply is idempotent, and emitted sender carries the session tag', async t => {
    const { root, source } = await fixture(t);
    assert.throws(() => patchPushNotifications(root, { check: true }), /missing/);
    assert.equal(await readFile(join(root, PUSH_FILE), 'utf8'), source);
    patchPushNotifications(root);
    patchPushNotifications(root);
    patchPushNotifications(root, { check: true });
    const { PushService } = await import(pathToFileURL(join(root, PUSH_FILE)).href);
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) };
    });
    const logger = { child: () => logger, error: () => assert.fail('unexpected push error') };
    await new PushService(logger, () => {}).sendPush(['test-recipient'], {
        title: 'Done', body: 'Done', data: { serverId: 'host', agentId: 'agent' },
    });
    assert.equal(requests[0][0].tag, 'paseodog-session:["host","agent"]');
    assert.equal(requests[0][0].channelId, 'paseodog-completion');
    assert.equal(requests[0][0].priority, 'high');
});

test('push patch rejects version drift, modified upstream and partial application before writing', async t => {
    const { root, source } = await fixture(t);
    await writeFile(join(root, 'package.json'), '{"version":"0.11.5"}');
    assert.throws(() => patchPushNotifications(root), /requires/);
    await writeFile(join(root, 'package.json'), '{"version":"0.11.4"}');
    await writeFile(join(root, PUSH_FILE), source + '\n// drift\n');
    assert.throws(() => patchPushNotifications(root), /hash mismatch/);
    await writeFile(join(root, PUSH_FILE), source);
    await writeFile(join(root, TAG_FILE), pushNotificationSources().tag);
    assert.throws(() => patchPushNotifications(root), /partial/);
    assert.equal(await readFile(join(root, PUSH_FILE), 'utf8'), source);
});
