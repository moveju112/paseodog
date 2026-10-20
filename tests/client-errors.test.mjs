import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, symlink, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClientErrorCollector, sanitizeClientError, CLIENT_ERROR_LIMITS } from '../plugin/server/client-errors.mjs';
import { clientErrors } from '../plugin/shared/client-errors.ts';

// 독립 임시 홈으로 실제 데몬·개인 프로필을 건드리지 않고 수집기를 만든다.
async function fixture(t, options = {}) {
    const home = await mkdtemp(join(tmpdir(), 'paseodog-client-errors-'));
    const collector = createClientErrorCollector({ home, ...options });
    t.after(async () => {
        await collector.close();
        await rm(home, { recursive: true, force: true });
    });
    return { ...collector, home, path: join(home, 'client-errors', 'events.jsonl') };
}

// 허용된 기본 이벤트에 검사할 필드만 덮어쓴다.
function event(overrides = {}) {
    return {
        id: randomUUID(), timestamp: Date.now(), source: 'app', code: 'TypeError',
        message: 'secret console text', appVersion: '1.0.0', platform: 'android', ...overrides,
    };
}

test('idle maintenance prunes expired records with an injected clock and tick, without startup writes', async (t) => {
    let time = Date.now(), tick, unrefCount = 0, cancelCount = 0;
    // 실제 타이머 대신 수동 틱과 해제 여부만 기록한다.
    const timer = { unref() { unrefCount++; } };
    const collector = await fixture(t, {
        now: () => time,
        // 실행 주기를 검증하고 수동으로 호출할 정리 작업을 보관한다.
        scheduleMaintenance(callback, intervalMs) {
            assert.equal(intervalMs, 3600000);
            tick = callback;
            return timer;
        },
        // 종료가 생성한 타이머만 해제하는지 확인한다.
        cancelMaintenance(value) {
            assert.equal(value, timer);
            cancelCount++;
        },
    });
    assert.equal(unrefCount, 1);
    await assert.rejects(stat(join(collector.home, 'client-errors')), { code: 'ENOENT' });
    await tick();
    await assert.rejects(stat(join(collector.home, 'client-errors')), { code: 'ENOENT' });
    assert.equal((await collector.handle({
        action: 'report', events: [event({ timestamp: time })],
    })).accepted, 1);
    time += CLIENT_ERROR_LIMITS.retentionMs + 1;
    await tick();
    assert.equal(await readFile(collector.path, 'utf8'), '', 'idle tick must expire disk records without a report');
    await collector.close();
    assert.equal(cancelCount, 1);
    assert.deepEqual(await tick(), { accepted: 0 }, 'a stale callback cannot mutate a closed collector');
});

test('authenticated plugin RPC contract is a strict discriminated union with bounded events', () => {
    assert.equal(clientErrors.name, 'client-errors');
    assert.deepEqual(clientErrors.input.parse({ action: 'clear' }), { action: 'clear' });
    assert.ok(clientErrors.input.safeParse({ action: 'report', events: [event()] }).success);
    for (const input of [
        { action: 'report' }, { action: 'clear', events: [] }, { action: 'disable' },
        { action: 'report', events: [event({ console: 'secret' })] },
        { action: 'report', events: [event({ timestamp: NaN })] },
        { action: 'report', events: [event({ message: 'x'.repeat(2049) })] },
        { action: 'report', events: Array.from({ length: 21 }, () => event()) },
    ]) assert.equal(clientErrors.input.safeParse(input).success, false);
    assert.deepEqual(clientErrors.output.parse({ accepted: 0 }), { accepted: 0 });
    assert.equal(clientErrors.output.safeParse({ accepted: -1 }).success, false);
});

test('strict server validation rejects unknown fields, bad values and oversized batches', async (t) => {
    const collector = await fixture(t);
    for (const changes of [
        { extra: 'secret' }, { id: 'bad' }, { timestamp: Infinity }, { timestamp: '123' },
        { source: 'x'.repeat(65) }, { stage: '' }, { code: '' }, { message: 'x'.repeat(2049) },
        { stack: 'x'.repeat(8193) }, { appVersion: '' }, { platform: 'linux' }, { osVersion: 1 },
    ]) await assert.rejects(collector.handle({ action: 'report', events: [event(changes)] }), /Invalid client error event/);
    await assert.rejects(collector.handle({ action: 'report', events: Array.from({ length: 21 }, () => event()) }), /batch/);
    await assert.rejects(collector.handle({ action: 'clear', events: [] }), /request/);
    await assert.rejects(collector.handle({ action: 'report' }), /batch/);
    await assert.rejects(stat(collector.path), { code: 'ENOENT' });
});

test('allowlist projection removes paths, tokens and arbitrary console content in every text field', async (t) => {
    const collector = await fixture(t);
    const secret = 'Bearer abc123 /home/alice/chat.txt https://host/?token=secret private user prompt';
    const input = event(Object.fromEntries(
        ['source', 'stage', 'code', 'message', 'stack', 'appVersion', 'osVersion'].map((key) => [key, 'token=/home/alice']),
    ));
    input.message = secret;
    assert.deepEqual(await collector.handle({ action: 'report', events: [input] }), { accepted: 1 });
    const text = await readFile(collector.path, 'utf8');
    for (const value of ['Bearer', 'alice', 'abc123', 'private user prompt', 'token=', 'https://'])
        assert.ok(!text.includes(value), value);
    const saved = JSON.parse(text);
    assert.equal(saved.message, '[redacted]');
    assert.equal(saved.stack, '[redacted]');
    assert.equal(saved.source, 'other');
    assert.equal(saved.appVersion, 'unknown');
    assert.deepEqual(Object.keys(saved).sort(), Object.keys(input).sort());
    assert.equal((await stat(collector.path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(collector.home, 'client-errors'))).mode & 0o777, 0o700);
    assert.equal(sanitizeClientError(event()).code, 'TypeError');
});

test('frontend picker and desktop classifications survive backend privacy projection', async (t) => {
    const collector = await fixture(t);
    const sources = ['console', 'global', 'rejection', 'image-picker', 'react', 'desktop-main'];
    const stages = ['permission', 'desktop', 'recovery', 'normalize', 'launch'];
    const codes = [
        'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError',
        'E_PICKER', 'ERR_NO_ACTIVITY', 'ERR_CANCELED', 'E_NO_LIBRARY_PERMISSION', 'E_PERMISSION_MISSING',
        'PICKER_LAUNCHER_UNREGISTERED', 'PICKER_ACTIVITY_UNAVAILABLE', 'PICKER_UNINITIALIZED',
        'MAIN_CONSOLE_ERROR', 'MAIN_UNHANDLED_REJECTION', 'MAIN_UNCAUGHT_EXCEPTION',
    ];
    const events = codes.map((code, index) => event({
        code, source: sources[index % sources.length], stage: stages[index % stages.length],
        message: '/home/private/chat token=secret', stack: 'at secret (/home/private/chat:1:2)',
    }));
    assert.equal((await collector.handle({ action: 'report', events })).accepted, events.length);
    const saved = (await readFile(collector.path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(saved.map((row) => [row.source, row.stage, row.code]),
        events.map((row) => [row.source, row.stage, row.code]));
    for (const row of saved) {
        assert.equal(row.message, '[redacted]');
        assert.equal(row.stack, '[redacted]');
    }
    for (const field of ['source', 'stage', 'code']) {
        const sanitized = sanitizeClientError(event({ [field]: 'PICKER_ACTIVITY_UNAVAILABLE_secret' }));
        assert.equal(sanitized[field], field === 'code' ? 'Error' : 'other');
    }
});

test('serialized reports dedupe IDs across restart, dedupe content and enforce bounded queue', async (t) => {
    const collector = await fixture(t);
    const input = event();
    const results = await Promise.all(Array.from({ length: 40 }, () => collector.handle({ action: 'report', events: [input] })));
    assert.equal(results.reduce((sum, row) => sum + row.accepted, 0), 1);
    assert.equal((await collector.handle({ action: 'report', events: [event()] })).accepted, 0);
    await collector.close();
    const restarted = createClientErrorCollector({ home: collector.home });
    t.after(() => restarted.close());
    assert.equal((await restarted.handle({ action: 'report', events: [input] })).accepted, 0);
    assert.equal((await readFile(collector.path, 'utf8')).trim().split('\n').length, 1);
});

test('retention, rate, record and file caps remain bounded', async (t) => {
    let time = Date.now();
    const collector = await fixture(t, { now: () => time });
    const first = event({ timestamp: time, appVersion: '1.0.0' });
    let accepted = 0;
    for (let index = 0; index < 80; index++) {
        accepted += (await collector.handle({
            action: 'report', events: [index === 0 ? first : event({ timestamp: time, appVersion: `1.0.${index}` })],
        })).accepted;
    }
    assert.equal(accepted, CLIENT_ERROR_LIMITS.rate);
    for (let minute = 1; minute <= 10; minute++) {
        time += 60001;
        for (let batch = 0; batch < 3; batch++) await collector.handle({
            action: 'report', events: Array.from({ length: 20 }, (_, index) =>
                event({ timestamp: time, appVersion: `2.${minute}.${batch * 20 + index}` })),
        });
    }
    assert.equal((await readFile(collector.path, 'utf8')).trim().split('\n').length, CLIENT_ERROR_LIMITS.records);
    assert.ok((await stat(collector.path)).size <= CLIENT_ERROR_LIMITS.bytes);
    const retained = (await readFile(collector.path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(retained.some((row) => row.id === first.id), 'capacity must not evict unexpired IDs');
    const restarted = createClientErrorCollector({ home: collector.home, now: () => time });
    t.after(() => restarted.close());
    assert.equal((await restarted.handle({ action: 'report', events: [first] })).accepted, 0);
    assert.equal((await restarted.handle({
        action: 'report', events: [event({ timestamp: time, appVersion: '9.9.9' })],
    })).accepted, 0, 'full collector refuses admission rather than sacrificing idempotency');
    time += CLIENT_ERROR_LIMITS.retentionMs + 1;
    const fresh = event({ timestamp: time });
    assert.equal((await collector.handle({ action: 'report', events: [fresh] })).accepted, 1);
    assert.equal((await readFile(collector.path, 'utf8')).trim().split('\n').length, 1);
    assert.equal((await collector.handle({
        action: 'report', events: [event({ timestamp: time + 300001 }), event({ timestamp: time - CLIENT_ERROR_LIMITS.retentionMs })],
    })).accepted, 0);
});

test('clear touches only owned log, disables report writes and serializes after report', async (t) => {
    const collector = await fixture(t);
    await collector.handle({ action: 'report', events: [event()] });
    const sibling = join(collector.home, 'client-errors', 'unrelated.txt');
    await writeFile(sibling, 'keep');
    await Promise.all([
        collector.handle({ action: 'report', events: [event({ code: 'RangeError' })] }),
        collector.handle({ action: 'clear' }),
    ]);
    await assert.rejects(stat(collector.path), { code: 'ENOENT' });
    assert.equal(await readFile(sibling, 'utf8'), 'keep');
    const disabled = await fixture(t, { enabled: false });
    assert.equal((await disabled.handle({ action: 'report', events: [event()] })).accepted, 0);
    await assert.rejects(stat(join(disabled.home, 'client-errors')), { code: 'ENOENT' });
    await disabled.handle({ action: 'clear' });
});

test('collector rejects symlinks and oversized existing logs without leaking error content', async (t) => {
    const collector = await fixture(t);
    const target = join(collector.home, 'private.txt');
    await writeFile(target, 'secret');
    await mkdir(join(collector.home, 'client-errors'));
    await symlink(target, collector.path);
    assert.deepEqual(await collector.handle({ action: 'report', events: [event()] }), { accepted: 0 });
    await assert.rejects(collector.handle({ action: 'clear' }), {
        name: 'Error', message: 'Client error clear failed',
    });
    assert.equal(await readFile(target, 'utf8'), 'secret');
    await rm(collector.path);
    assert.deepEqual(await collector.handle({ action: 'clear' }), { accepted: 0 }, 'failed clear does not poison queue');
    const oversized = await fixture(t);
    await mkdir(join(oversized.home, 'client-errors'));
    await writeFile(oversized.path, 'x'.repeat(CLIENT_ERROR_LIMITS.bytes + 1));
    assert.deepEqual(await oversized.handle({ action: 'report', events: [event()] }), { accepted: 0 });
    await assert.rejects(oversized.handle({ action: 'clear' }), {
        name: 'Error', message: 'Client error clear failed',
    });
});

test('clear rejects a full or closed queue instead of reporting false success', async (t) => {
    const collector = await fixture(t);
    const reports = Array.from({ length: CLIENT_ERROR_LIMITS.queue }, () =>
        collector.handle({ action: 'report', events: [event()] }));
    await assert.rejects(collector.handle({ action: 'clear' }), {
        name: 'Error', message: 'Client error clear failed',
    });
    await Promise.all(reports);
    assert.deepEqual(await collector.handle({ action: 'clear' }), { accepted: 0 });
    await collector.close();
    await assert.rejects(collector.handle({ action: 'clear' }), {
        name: 'Error', message: 'Client error clear failed',
    });
    assert.deepEqual(await collector.handle({ action: 'report', events: [event()] }), { accepted: 0 });
});
