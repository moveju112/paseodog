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
    const shown = { tail: tail.filter(visible), head: head.filter(visible) };
    if (shown.tail.length || shown.head.length) return shown;
    // 불러온 범위가 모두 숨겨지면 완료된 턴의 마지막 답변 묶음만 남겨 빈 대화로 보이지 않게 한다.
    let last = null;
    for (let index = items.length - 1; index >= 0 && !last; index--) {
        const item = items[index];
        if (item.kind === 'assistant_message' && groups.get(item) !== active && item.text.trim() !== '') last = item;
    }
    if (!last) return shown;
    const lastId = last.blockGroupId ?? last.id;
    const kept = (item) => item.kind === 'assistant_message' && (item.blockGroupId ?? item.id) === lastId &&
        item.text.trim() !== '';
    return { tail: tail.filter(kept), head: head.filter(kept) };
}

// 설치 번들에 남은 이전 answerOnlyRows 원문 (정규화 대상)
const PREVIOUS_ANSWER_ONLY_SOURCES = [
    "function answerOnlyRows(tail, head, isTurnActive) {\n    const items = [...tail, ...head];\n    const groups = new Map();\n    const answers = new Map();\n    let group = null;\n    for (const item of items) {\n        if (item.kind === 'user_message') group = item.id;\n        const key = item.turnId ?? group;\n        groups.set(item, key);\n        if (item.kind === 'assistant_message') answers.set(key, item.blockGroupId ?? item.id);\n        if (item.kind === 'tool_call') answers.delete(key);\n    }\n    const active = isTurnActive && items.length ? groups.get(items[items.length - 1]) : undefined;\n    // 표시 배열에서 제거해 숨긴 행의 레이아웃 여백도 남기지 않는다.\n    const visible = (item) => {\n        if (item.kind === 'assistant_message') {\n            const key = groups.get(item);\n            return key !== active && answers.get(key) === (item.blockGroupId ?? item.id) && item.text.trim() !== '';\n        }\n        return item.kind === 'user_message' || item.kind === 'plugin' ||\n            (item.kind === 'notification' && item.level !== 'info');\n    };\n    return { tail: tail.filter(visible), head: head.filter(visible) };\n}",
];

// 이전 답변 전용 원문 -> 현재 원문 치환 (기존 패치 정규화·부분 적용 검사를 그대로 재사용)
export function withCurrentAnswerOnly(source) {
    const current = answerOnlyRows.toString();
    return PREVIOUS_ANSWER_ONLY_SOURCES.reduce((text, previous) => text.split(previous).join(current), source);
}
