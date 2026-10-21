// A안 표시: 공용 TypeScript의 타입만 지워 같은 묶음·렌더러를 검토된 Metro 번들에 주입한다.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

// 별도 구현을 복제하지 않고 공용 순수 함수·의존성 주입 렌더러를 그대로 재사용한다.
function sourceFunction(file, name) {
    const code = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/agent-stream/' + file, import.meta.url), 'utf8'))
        .replace(/^export /gm, '');
    return new Function(`${code}\nreturn ${name};`)().toString();
}

const projection = sourceFunction('work-record-model.ts', 'projectWorkRecords');
const renderer = sourceFunction('work-record-renderer.ts', 'createWorkRecordRenderer');
const recordGap = sourceFunction('work-record-model.ts', 'getWorkRecordGap');
const projectionStart = 'e.createStreamPresentation=function(){const l=new WeakMap,H=';
const projectionInjected = `e.createStreamPresentation=function(){const pdRecordCache={records:new Map,answers:new WeakMap},pdWork=${projection};const l=new WeakMap,H=`;
const viewStart = 'function ae(e){return e.pendingPermissions||';
const viewInjected = `const pdRenderWorkRecord=(${renderer})({React:h,View:f.withUnistyles(l.View),Text:f.withUnistyles(l.Text),Pressable:f.withUnistyles(l.Pressable),StyleSheet:f.StyleSheet,useTranslation:y.useTranslation});${viewStart}`;
const spacingEdits = [
    ['e.getGapBetweenStreamItems=function(u,c){if(!u||!c)return 0;',
        `e.getGapBetweenStreamItems=function(u,c){const pdGap=(${recordGap})(u,c);if(null!==pdGap)return pdGap;if(!u||!c)return 0;`],
    ['trailingRowHidden:{opacity:0},trailingRowVisible:{opacity:1},timestampText:',
        'trailingRowHidden:{opacity:0},trailingRowFloating:{position:"absolute",top:-e.spacing[3],right:e.spacing[2],marginTop:0,paddingHorizontal:e.spacing[1],borderRadius:e.borderRadius.sm,backgroundColor:e.colors.surface1,zIndex:1,uni__dependencies:[0]},trailingRowVisible:{opacity:1},timestampText:'],
    ['const ve=je,Te=Y?Be.trailingRowVisible:Be.trailingRowHidden;let Le;t[32]!==Te?(Le=[Be.trailingRow,Te],t[32]=Te,t[33]=Le):Le=t[33];const Ce=Le;',
        'const ve=je,Te=Y?Be.trailingRowVisible:Be.trailingRowHidden,Ce=[Be.trailingRow,Te,ne.isWeb&&!O&&X?Be.trailingRowFloating:void 0];'],
];

export const WORK_RECORD_EDITS = [
    ['type:d.z.literal("assistant_message"),text:d.z.string(),messageId:d.z.string().optional()}',
        'type:d.z.literal("assistant_message"),text:d.z.string(),messageId:d.z.string().optional(),phase:d.z.enum(["commentary","final_answer"]).optional()}'],
    ['case"assistant_message":return E(A(e,c.text,n,s,c.messageId,i,o))',
        'case"assistant_message":return E(A(e,c.text,n,s,c.messageId,i,o,c.phase))'],
    ['function A(e,t,n,s,i,o,c){const{chunk:l,hasContent:u}=S(t);if(!l)return e;const h=e[e.length-1];if(h&&"assistant_message"===h.kind&&(void 0===i||h.messageId===i)){const t=Object.assign({},h,{text:`${h.text}${l}`,timestamp:n},c?{timelineCursor:c}:{});return[...e.slice(0,-1),t]}const f=e[e.length-2];if("live"===s&&"user_message"===h?.kind&&"assistant_message"===f?.kind&&(void 0===i||f.messageId===i)){const t=Object.assign({},f,{text:`${f.text}${l}`,timestamp:n},c?{timelineCursor:c}:{});return[...e.slice(0,-2),t,h]}if(!u)return e;const I=p(e,i,l.trim()||l,n,o),k=Object.assign({kind:"assistant_message",id:I},i?{messageId:i}:{},c?{timelineCursor:c}:{},{text:l,timestamp:n});return[...e,k]}',
        'function A(e,t,n,s,i,o,c,pdPhase){const{chunk:l,hasContent:u}=S(t);if(!l&&!pdPhase)return e;const h=e[e.length-1];if(h&&"assistant_message"===h.kind&&(void 0===i||h.messageId===i)){const t=Object.assign({},h,{text:`${h.text}${l}`,timestamp:n},c?{timelineCursor:c}:{},pdPhase?{assistantPhase:pdPhase}:{});return[...e.slice(0,-1),t]}const f=e[e.length-2];if("live"===s&&"user_message"===h?.kind&&"assistant_message"===f?.kind&&(void 0===i||f.messageId===i)){const t=Object.assign({},f,{text:`${f.text}${l}`,timestamp:n},c?{timelineCursor:c}:{},pdPhase?{assistantPhase:pdPhase}:{});return[...e.slice(0,-2),t,h]}if(!u)return e;const I=p(e,i,l.trim()||l,n,o),k=Object.assign({kind:"assistant_message",id:I},i?{messageId:i}:{},c?{timelineCursor:c}:{},{text:l,timestamp:n},pdPhase?{assistantPhase:pdPhase}:{});return[...e,k]}'],
    ['kind:t.z.literal("assistant_message"),messageId:t.z.string().optional(),text:t.z.string()}',
        'kind:t.z.literal("assistant_message"),messageId:t.z.string().optional(),text:t.z.string(),assistantPhase:t.z.enum(["commentary","final_answer"]).optional()}'],
    ['case"assistant_message":return Object.assign({},s,{kind:t.kind},t.messageId?{messageId:t.messageId}:{},{text:t.text})',
        'case"assistant_message":return Object.assign({},s,{kind:t.kind},t.messageId?{messageId:t.messageId}:{},{text:t.text},t.assistantPhase?{assistantPhase:t.assistantPhase}:{})', 2],
    ['return t.id===n&&t.turnId===s.turnId&&t.timestamp.getTime()',
        'return t.id===n&&t.assistantPhase===s.assistantPhase&&t.turnId===s.turnId&&t.timestamp.getTime()'],
    [projectionStart, projectionInjected],
    ['y=s.hideReasoning?H(T,o,s.isTurnActive):{tail:T,head:o}',
        'y=s.hideReasoning&&!s.groupWorkRecords?H(T,o,s.isTurnActive):{tail:T,head:o}'],
    ['(0,n.projectToolCallDetailLevel)({level:s.level,tail:y.tail,head:y.head,preparedHistory:b,isTurnActive:s.isTurnActive})',
        '(s.groupWorkRecords?pdWork((0,n.projectToolCallDetailLevel)({level:s.level,tail:y.tail,head:y.head,preparedHistory:b,isTurnActive:s.isTurnActive}),s.isTurnActive,pdRecordCache,s.hideReasoning):(0,n.projectToolCallDetailLevel)({level:s.level,tail:y.tail,head:y.head,preparedHistory:b,isTurnActive:s.isTurnActive}))'],
    ['isTurnActive:Nt,hideReasoning:pdHideReasoning}', 'isTurnActive:Nt,hideReasoning:pdHideReasoning,groupWorkRecords:!0}'],
    [viewStart, viewInjected],
    ['content:Ln(e),layoutItem:e,strategy:Ne,', 'content:pdRenderWorkRecord(e,Ln),layoutItem:e,strategy:Ne,'],
    ...spacingEdits,
];

// 기존 composer의 전체 blob gate를 통과한 원본 앵커에만 표시를 추가한다.
export function withWorkRecords(source) {
    for (const [before, after, count = 1] of WORK_RECORD_EDITS) {
        if (source.split(before).length !== count + 1 || source.includes(after)) throw new Error('Paseo work record anchor mismatch');
        source = source.split(before).join(after);
    }
    return source;
}

// 이전에 검토한 기록 간격 주입만 현재 간격 주입으로 바꾼다 (기록→답변 4px 판).
function withCurrentRecordGap(source) {
    const startMarker = 'e.getGapBetweenStreamItems=function(u,c){const pdGap=(';
    const endMarker = 'if(null!==pdGap)return pdGap;if(!u||!c)return 0;';
    const start = source.indexOf(startMarker);
    if (start === -1 || source.includes(spacingEdits[0][1])) return source;
    const end = source.indexOf(endMarker, start);
    const previous = source.slice(start, end + endMarker.length);
    if (end === -1 || createHash('sha256').update(previous).digest('hex') !== '91a7705fa05b5594d7840958f36579ae2675d7782b3b7f3f802bf502a1365d1f')
        throw new Error('Paseo work record legacy gap drift');
    return source.replace(previous, spacingEdits[0][1]);
}

// 전체 패치만 제거해 기존 번들 원본 해시 검증과 독립 패치 검사를 보존한다.
export function withoutWorkRecords(source) {
    let edits = WORK_RECORD_EDITS;
    source = withCurrentRecordGap(source);
    const start =source.indexOf('e.createStreamPresentation=function(){const pdRecordCache=');
    if (start !== -1 && !source.includes(projectionInjected)) {
        const endMarker = ';const l=new WeakMap,H=';
        const end = source.indexOf(endMarker, start);
        const previous = source.slice(start, end + endMarker.length);
        if (end === -1 || createHash('sha256').update(previous).digest('hex') !== '77b55376fb26b763b90c94346a7eb757f9009d1311d49cd9a6bd2973e092fa6c')
            throw new Error('Paseo work record legacy projection drift');
        source = source.replace(previous, projectionInjected);
        edits = WORK_RECORD_EDITS.slice(0, -spacingEdits.length);
    }
    const counts = edits.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count, index) => count !== 0 && count !== (edits[index][2] ?? 1)))
        throw new Error('Paseo work record drift');
    if (counts.includes(0) && counts.some((count) => count > 0)) throw new Error('Partial Paseo work record patch');
    return [...edits].reverse().reduce((result, [before, after]) => result.split(after).join(before), source);
}
