import { textOf } from '../../plugin/server/util.mjs';

// 소유한 네이티브 세션의 기능만 호출하고 모델 컨텍스트는 원본 런타임에 맡긴다.
export async function nativeSessionAction(runtime, request, { selectMcp } = {}) {
    const { operation, checkpointId, file, revision, confirmed, messageStart = 0 } = request;
    if (operation === 'mcpConnect') {
        if (confirmed !== true || typeof request.name !== 'string' || !request.name.trim())
            throw new Error('연결할 MCP 서버를 직접 선택하고 확인해 주세요.');
        if (selectMcp) await selectMcp(request.name);
        const status = await runtime.reconnectMcp(request.name);
        const row = status.servers.find((server) => server.name === request.name);
        if (!row) throw new Error('MCP 연결 상태를 확인할 수 없어요.');
        return { name: row.name, connected: row.connected === true };
    }
    if (!runtime.id) throw new Error('먼저 이 세션에서 대화를 시작해 주세요.');
    if (operation === 'fork') {
        if (confirmed !== true) throw new Error('대화 계승 확인이 필요해요.');
        const result = await runtime.inheritToNewSession(runtime.id, { titleSuffix: ' (Fork)' });
        return { nativeSessionId: result.sessionId, compacted: result.compacted };
    }
    if (operation === 'context') {
        if (!Number.isInteger(messageStart) || messageStart < 0) throw new Error('Invalid message offset');
        const result = runtime.readModelMessages(messageStart);
        return {
            messageCount: result.messageCount, messageStart,
            messages: result.messages.slice(0, 12).map((message) => ({
                role: message.role, text: textOf(message.content).slice(0, 8000),
                ...(Array.isArray(message.content) && message.content.some((part) => part.type !== 'text')
                    ? { nonTextParts: message.content.filter((part) => part.type !== 'text').map((part) => part.type) } : {}),
            })),
        };
    }
    if (operation === 'history') {
        const { loadTurnChangeRecords } = await import('mixdog/src/runtime/shared/turn-snapshot-store.mjs');
        const records = await loadTurnChangeRecords(runtime.id);
        return { turns: records.slice(-100).reverse().map((record) => ({
            checkpointId: record.checkpointId, files: record.files.length,
        })) };
    }
    if (operation === 'rewind') return rewindSession(runtime, request);
    if (operation === 'changes') return runtime.getTurnChanges({ checkpointId, patch: Boolean(file), file });
    if (operation === 'review') return runtime.getSessionReviewDiff();
    if (operation === 'undo' || operation === 'redo') {
        if (confirmed !== true) throw new Error('파일 변경 확인이 필요해요.');
        return operation === 'undo'
            ? runtime.revertTurnChanges(checkpointId, file || null, revision)
            : runtime.reapplyTurnChanges(checkpointId, file || null, revision);
    }
    throw new Error('Unsupported native session action');
}

// 사용자 메시지 시점으로 되돌리기 (대상 확인 -> 이후 턴 파일 최신순 복구 -> 모델 대화 절단)
async function rewindSession(runtime, { scope, text, since, confirmed }) {
    if (confirmed !== true) throw new Error('되돌리기 확인이 필요해요.');
    if (!['conversation', 'files', 'both'].includes(scope)) throw new Error('Invalid rewind scope');
    const conversation = scope !== 'files', files = scope !== 'conversation';
    const target = typeof text === 'string' ? text.trim() : '';
    if (conversation && !target) throw new Error('Invalid rewind target');
    if (files && !Number.isFinite(since)) throw new Error('Invalid rewind time');
    if (conversation) {
        // 파일을 바꾸기 전에 원본 절단 기준(같은 텍스트의 마지막 사용자 메시지)이 남아 있는지 확인한다.
        const { promptContentText } = await import('mixdog/src/runtime/agent/orchestrator/session/manager/prompt-utils.mjs');
        const { messages } = runtime.readModelMessages(0);
        if (!messages.some((message) => message?.role === 'user' && promptContentText(message.content).trim() === target))
            throw new Error('모델 대화에서 되돌릴 메시지를 찾지 못했어요. 압축된 대화는 되돌릴 수 없어요.');
    }
    let turns = 0;
    if (files) {
        const { loadTurnChangeRecords } = await import('mixdog/src/runtime/shared/turn-snapshot-store.mjs');
        const records = (await loadTurnChangeRecords(runtime.id))
            .filter((record) => Number(record.createdAt) >= since
                && (record.files || []).some((entry) => entry.state !== 'reverted'))
            .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
        for (const record of records) {
            try { await runtime.revertTurnChanges(record.checkpointId, null, Number(record.revision)); }
            catch (error) {
                throw new Error(`파일 복구가 최근 ${turns}개 턴까지만 적용됐어요. 대화는 바꾸지 않았어요: ${error.message}`);
            }
            turns++;
        }
    }
    if (!conversation) return { turns };
    const result = await runtime.rewindMessages({ text: target });
    if (!result) throw new Error(`대화를 되돌리지 못했어요.${turns ? ` 파일은 최근 ${turns}개 턴을 복구했어요.` : ''}`);
    return { turns, removed: result.removed };
}
