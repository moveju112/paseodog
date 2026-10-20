// 답변 전용 표시 (턴별 마지막 도구 이후 답변만 유지, 진행 중 본문·도구·추론 행 제외)
export function answerOnlyRows(tail, head, isTurnActive) {
    const items = [...tail, ...head];
    const groups = new Map();
    const answers = new Map();
    let group = null;
    for (const item of items) {
        if (item.kind === 'user_message') group = item.id;
        const key = item.turnId ?? group;
        groups.set(item, key);
        if (item.kind === 'assistant_message') answers.set(key, item.blockGroupId ?? item.id);
        if (item.kind === 'tool_call') answers.delete(key);
    }
    const active = isTurnActive && items.length ? groups.get(items[items.length - 1]) : undefined;
    // 표시 배열에서 제거해 숨긴 행의 레이아웃 여백도 남기지 않는다.
    const visible = (item) => {
        if (item.kind === 'assistant_message') {
            const key = groups.get(item);
            return key !== active && answers.get(key) === (item.blockGroupId ?? item.id) && item.text.trim() !== '';
        }
        return item.kind === 'user_message' || item.kind === 'plugin' ||
            (item.kind === 'notification' && item.level !== 'info');
    };
    return { tail: tail.filter(visible), head: head.filter(visible) };
}
