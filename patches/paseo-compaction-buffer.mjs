// 로컬 패치: 검토된 AI 엔진 설정의 압축 여유 버퍼 선택지를 Mixdog 상한(25%)에 맞춘 10/20/25%로 바꾼다.
// 앱 원본(android/packages/app/src/screens/settings/ai-engine-page.tsx bufferOptions)과 같은 값·문구를 쓴다.
export const COMPACTION_BUFFER_ANCHOR = String.raw`[{value:"0.15",label:"15% \xb7 \ucd5c\ub300 \uc808\uac10"},{value:"0.2",label:"20% \xb7 \uade0\ud615 (\uad8c\uc7a5)"},{value:"0.3",label:"30% \xb7 \uc5ec\uc720 \ud655\ubcf4"}]`;
export const COMPACTION_BUFFER = String.raw`[{value:"0.1",label:"10% \xb7 \ub9e5\ub77d \ucd5c\ub300 \uc720\uc9c0"},{value:"0.2",label:"20% \xb7 \uade0\ud615 (\uad8c\uc7a5)"},{value:"0.25",label:"25% \xb7 \ud1a0\ud070 \ucd5c\ub300 \uc808\uac10"}]`;

// 패치된 선택지를 원본으로 되돌려 전체 번들 원본 해시 검증을 유지한다.
export function withoutCompactionBuffer(source) {
    return source.replace(COMPACTION_BUFFER, () => COMPACTION_BUFFER_ANCHOR);
}

// 원본 해시를 통과한 번들의 정확한 앵커 하나에만 새 선택지를 넣는다.
export function withCompactionBuffer(source) {
    if (source.split(COMPACTION_BUFFER_ANCHOR).length !== 2) throw new Error('Paseo compaction buffer anchor mismatch');
    return source.replace(COMPACTION_BUFFER_ANCHOR, () => COMPACTION_BUFFER);
}
