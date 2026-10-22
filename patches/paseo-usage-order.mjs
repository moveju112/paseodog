// 로컬 패치: 검토된 사이드바 쿼터 요약(resolvePinnedUsage)의 공급자 순서를 보고서 도착 순서 대신 Claude -> Codex -> 나머지 sourceId -> 보고서 id 순으로 고정한다.
// 주간 창의 짧은 이름 "wk"(호스트 SDK·내장 소스가 604800초 주간 창에만 붙이는 이름)만 사이드바에서 "7D"로 맞추고, 쿼터 값·창 id·접근성 라벨·5H 등 다른 짧은 이름은 원본 그대로 둔다.
export const USAGE_ORDER_EDITS = [
    ['function b(n){return[...new Set(n.map(n=>n.sourceId))].flatMap(t=>n.filter(n=>n.sourceId===t))}',
        'function b(n){const k=n=>{const t=["claude","codex"].indexOf(n.sourceId);return t<0?2:t},q=(n,t)=>n<t?-1:n>t?1:0;return[...n].sort((n,t)=>k(n)-k(t)||q(n.sourceId,t.sourceId)||q(n.id,t.id))}'],
    ['shortLabel:s.shortLabel??s.label,', 'shortLabel:"wk"===(s.shortLabel??s.label)?"7D":s.shortLabel??s.label,'],
];

// 문자열 안 정확한 일치 횟수를 센다.
function occurrences(source, text) {
    return source.split(text).length - 1;
}

// 이전 버전 패치의 Codex -> Claude 순서 (원래 앵커로 되돌린 뒤 새 순서로 다시 적용한다)
const LEGACY_ORDER_EDIT = USAGE_ORDER_EDITS[0][1].replace('["claude","codex"]', '["codex","claude"]');

// 패치된 두 지점이 모두 하나씩 있을 때만 원래 앵커로 되돌려 원본 해시 검증을 유지한다(중복·일부 적용은 실패).
export function withoutUsageOrder(source) {
    if (source.split(LEGACY_ORDER_EDIT).length > 2) throw new Error('Paseo usage order patch drift');
    source = source.replace(LEGACY_ORDER_EDIT, () => USAGE_ORDER_EDITS[0][1]);
    const counts = USAGE_ORDER_EDITS.map(([, after]) => occurrences(source, after));
    if (counts.some((count) => count > 1)) throw new Error('Paseo usage order patch drift');
    if (counts.includes(0) && counts.includes(1)) throw new Error('Partial Paseo usage order patch');
    return USAGE_ORDER_EDITS.reduce((result, [before, after]) => result.replace(after, () => before), source);
}

// 전체 원본 해시를 통과한 번들의 유일한 두 앵커에만 고정 순서와 주간 7D 표시를 붙인다.
export function withUsageOrder(source) {
    for (const [before, after] of USAGE_ORDER_EDITS) {
        if (occurrences(source, before) !== 1 || source.includes(after))
            throw new Error('Paseo usage order anchor mismatch');
    }
    return USAGE_ORDER_EDITS.reduce((result, [before, after]) => result.replace(before, () => after), source);
}
