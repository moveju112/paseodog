import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 설치된 네이티브 판정 함수를 상태 저장 없이 실행해 경계 조건을 검사한다.
function predicate(entries) {
    const source = readFileSync(new URL('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/manager/pending-messages.mjs', import.meta.url), 'utf8');
    const start = source.indexOf('export function pendingQueueHoldsOnlyHostSteering(');
    const end = source.indexOf('// Drain order:', start);
    const body = source.slice(start, end).replace('export function', 'function');
    return new Function('_sessionPendingMessages', '_hydratedPendingMessages', 'pendingEntryMode', 'PENDING_MODE_TASK_NOTIFICATION',
        body + '\nreturn pendingQueueHoldsOnlyHostSteering("test");')(
        new Map([['test', entries]]), new Map(), (entry) => entry.mode || 'prompt', 'task-notification');
}

test('only explicitly tagged host steering may bypass the terminal-only prompt queue', () => {
    assert.equal(predicate([]), false);
    assert.equal(predicate([{ content: 'ordinary queued prompt' }]), false);
    assert.equal(predicate([{ content: 'B', options: { paseodogSteering: true } }]), true);
    assert.equal(predicate([{ content: 'B', options: { paseodogSteering: 'true' } }]), false);
    assert.equal(predicate([
        { content: 'B', options: { paseodogSteering: true } },
        { content: 'completed', mode: 'task-notification' },
    ]), true);
    assert.equal(predicate([
        { content: 'B', options: { paseodogSteering: true } },
        { content: 'ordinary queued prompt' },
    ]), false);
});
