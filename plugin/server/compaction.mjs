// 압축 이벤트의 표시용 필드만 전달하고 원문·메시지 ID·내부 경로는 제외한다.
export function projectCompaction(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { value = {}; }
    }
    const result = {};
    if (['compacting', 'compacted', 'skipped', 'failed', 'cancelled', 'canceled'].includes(value?.status))
        result.status = value.status;
    if (['auto', 'manual'].includes(value?.trigger)) result.trigger = value.trigger;
    for (const key of ['beforeTokens', 'afterTokens', 'preTokens', 'postTokens'])
        if (Number.isFinite(value?.[key]) && value[key] >= 0) result[key] = value[key];
    for (const key of ['changed', 'skipped'])
        if (typeof value?.[key] === 'boolean') result[key] = value[key];
    return result;
}

// 알려진 결과만 한국어로 요약하고 새 이벤트 형식도 원문을 노출하지 않는다.
export function compactionNotice(value) {
    const event = projectCompaction(value);
    const failed = event.status === 'failed';
    const canceled = ['cancelled', 'canceled'].includes(event.status);
    const skipped = event.skipped || event.status === 'skipped' || event.changed === false;
    const completed = event.status === 'compacted' || event.changed === true;
    const title = failed ? '컨텍스트 압축 실패' : canceled ? '컨텍스트 압축 취소'
        : skipped ? '컨텍스트 압축 건너뜀' : completed ? '컨텍스트 압축 완료'
        : event.status === 'compacting' ? '컨텍스트 압축 중' : '컨텍스트 압축 상태 업데이트';
    const before = event.beforeTokens ?? event.preTokens;
    const after = event.afterTokens ?? event.postTokens;
    return { message: title + (before !== undefined && after !== undefined
        ? ` · ${before.toLocaleString('ko-KR')} → ${after.toLocaleString('ko-KR')} 토큰` : ''),
        level: failed ? 'error' : canceled ? 'warning' : 'info' };
}
