// 로컬 패치: 토큰 설정의 Main 모델 선행 조건과 압축 여유 버퍼 상한을 앱과 맞춘다.
// 앱 원본(android/packages/app/src/screens/settings/ai-engine-page.tsx bufferOptions)과 같은 값·문구를 쓴다.
export const COMPACTION_BUFFER_ANCHOR = String.raw`[{value:"0.15",label:"15% \xb7 \ucd5c\ub300 \uc808\uac10"},{value:"0.2",label:"20% \xb7 \uade0\ud615 (\uad8c\uc7a5)"},{value:"0.3",label:"30% \xb7 \uc5ec\uc720 \ud655\ubcf4"}]`;
export const COMPACTION_BUFFER = String.raw`[{value:"0.1",label:"10% \xb7 \ub9e5\ub77d \ucd5c\ub300 \uc720\uc9c0"},{value:"0.2",label:"20% \xb7 \uade0\ud615 (\uad8c\uc7a5)"},{value:"0.25",label:"25% \xb7 \ud1a0\ud070 \ucd5c\ub300 \uc808\uac10"}]`;
export const CONTEXT_LIMIT_ANCHOR = String.raw`const se=String(l.route.contextPercent??100);let ie,ne;t[35]!==s||t[36]!==y||t[37]!==se?(ie=(0,C.jsx)(I,{title:"\uba54\uc778 \ucee8\ud14d\uc2a4\ud2b8 \ud55c\ub3c4 \ube44\uc728",hint:"\ubaa8\ub378 \ucd5c\ub300 \ucee8\ud14d\uc2a4\ud2b8 \uc911 \uc0ac\uc6a9\ud560 \uc0c1\ud55c \ube44\uc728\uc744 \uc81c\ud55c\ud574 \uacfc\ub3c4\ud55c \uacfc\uae08 \ubc29\uc9c0",children:(0,C.jsx)(D,{title:"\uba54\uc778 \ucee8\ud14d\uc2a4\ud2b8 \ud55c\ub3c4 \ube44\uc728",disabled:s,value:se,options:M,onChange:y})}),t[35]=s,t[36]=y,t[37]=se,t[38]=ie):ie=t[38]`;
// 이 행은 model 유무도 바뀌므로 이전 컴파일러의 세 필드 memo cache를 재사용하지 않는다.
export const CONTEXT_LIMIT = `const hasMainModel=Boolean(l.route.model?.trim()),se=hasMainModel?String(l.route.contextPercent??100):"Main 모델 선택 필요";let ie,ne;ie=(0,C.jsx)(I,{title:"메인 컨텍스트 한도 비율",hint:hasMainModel?"모델 최대 컨텍스트 중 사용할 상한 비율을 제한해 과도한 과금 방지":"새 대화 입력창에서 Main 모델을 먼저 선택해 주세요.",children:(0,C.jsx)(D,{title:"메인 컨텍스트 한도 비율",disabled:s||!hasMainModel,value:se,options:M,onChange:hasMainModel?y:()=>{}})})`;

// 패치된 선택지를 원본으로 되돌려 전체 번들 원본 해시 검증을 유지한다.
export function withoutCompactionBuffer(source) {
    return source.replace(CONTEXT_LIMIT, () => CONTEXT_LIMIT_ANCHOR)
        .replace(COMPACTION_BUFFER, () => COMPACTION_BUFFER_ANCHOR);
}

// 원본 해시를 통과한 번들의 정확한 앵커 하나에만 새 선택지를 넣는다.
export function withCompactionBuffer(source) {
    if (source.split(COMPACTION_BUFFER_ANCHOR).length !== 2) throw new Error('Paseo compaction buffer anchor mismatch');
    if (source.split(CONTEXT_LIMIT_ANCHOR).length !== 2) throw new Error('Paseo context limit anchor mismatch');
    return source.replace(COMPACTION_BUFFER_ANCHOR, () => COMPACTION_BUFFER)
        .replace(CONTEXT_LIMIT_ANCHOR, () => CONTEXT_LIMIT);
}
