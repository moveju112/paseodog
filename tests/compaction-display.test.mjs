import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCompaction, compactionNotice } from '../plugin/server/compaction.mjs';
import { fixture } from './helpers.mjs';

test('compaction projection strips large internal identity lists without changing counters', () => {
    const source = { status: 'compacted', trigger: 'auto', beforeTokens: 499158, afterTokens: 55864,
        changed: true, sessionId: 'secret', droppedIdentities: { messageIds: Array(500).fill('private') } };
    assert.deepEqual(projectCompaction(source), { status: 'compacted', trigger: 'auto',
        beforeTokens: 499158, afterTokens: 55864, changed: true });
    assert.equal(compactionNotice(source).message, '컨텍스트 압축 완료 · 499,158 → 55,864 토큰');
    assert.doesNotMatch(JSON.stringify(projectCompaction(source)), /private|secret/);
    assert.equal(source.droppedIdentities.messageIds.length, 500);
});
test('unknown and legacy events never leak raw metadata or invent completion', () => {
    for (const value of ['truncated private JSON', { status: 'future', error: '/private/key' }, null])
        assert.deepEqual(compactionNotice(value), { message: '컨텍스트 압축 상태 업데이트', level: 'info' });
    assert.equal(compactionNotice(JSON.stringify({ status: 'failed' })).level, 'error');
    assert.match(compactionNotice({ skipped: true }).message, /건너뜀/);
    assert.match(compactionNotice({ status: 'canceled' }).message, /취소/);
});
test('native compaction updates use a stable timeline item and a safe readable notification', async (t) => {
    const f = fixture({ async ask(text, callbacks) {
        callbacks.onCompactEvent({ status: 'compacting' });
        callbacks.onCompactEvent({ status: 'compacted', beforeTokens: 100, afterTokens: 20, droppedIdentities: ['private'] });
        return { content: 'done' };
    } });
    t.after(() => f.connection.close());
    await f.ready(); await f.run();
    const wire = JSON.stringify(f.events);
    assert.doesNotMatch(wire, /private|Mixdog compaction|droppedIdentities/);
    assert.match(wire, /100 → 20 토큰/);
    const items = f.events.filter((e) => e.item?.type === 'compaction').map((e) => e.item);
    assert.deepEqual(items.map((item) => item.status), ['loading', 'completed']);
    assert.equal(items[0].id, items[1].id);
});
