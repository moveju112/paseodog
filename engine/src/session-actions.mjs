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
