// 로컬 패치: "추론 숨기기"를 켜면 표시 단계에서 완료된 최종 답변만 남긴다.
// 모델 추론·네이티브 기록·스트림 원본·승인·오류·플러그인 행은 유지한다.
// 공유 앱 원본(android/packages/app/src)의 같은 설정·표시 투영과 같은 의미다.
import { answerOnlyRows } from './answer-only.mjs';

// 번들 문자열 리터럴과 같은 방식(0x7f 이상은 \xNN 또는 \uXXXX)으로 이스케이프한다.
function escapeBundleText(text) {
    return [...text].map((character) => {
        const code = character.codePointAt(0);
        if (code < 0x7f) return character;
        return code <= 0xff ? '\\x' + code.toString(16).padStart(2, '0') : '\\u' + code.toString(16).padStart(4, '0');
    }).join('');
}

// [기존 "추론 항상 펼치기" 라벨, 설명, 새 라벨, 새 설명] — 번들 언어 순서(ar, en, es, fr, ja, ko, pt-BR, ru, zh-CN)
const LOCALES = [
    ['عرض التفكير دائماً', 'إظهار تفكير الوكيل وخطوات الاستدلال بشكل كامل بشكل افتراضي',
        'إخفاء التفكير', 'إخفاء كتل تفكير الوكيل في المحادثة؛ تبقى الإجابات والأدوات والموافقات والتقدم ظاهرة'],
    ['Always expand reasoning', 'Show agent thinking and chain-of-thought blocks fully expanded by default',
        'Hide reasoning', 'Hide agent thinking blocks in chat; answers, tools, approvals and progress stay visible'],
    ['Siempre expandir razonamiento', 'Mostrar los bloques de pensamiento y razonamiento del agente totalmente expandidos de forma predeterminada',
        'Ocultar razonamiento', 'Ocultar los bloques de pensamiento del agente en el chat; las respuestas, herramientas, aprobaciones y el progreso siguen visibles'],
    ['Toujours afficher le raisonnement', 'Afficher par défaut le raisonnement de l’agent entièrement déplié',
        'Masquer le raisonnement', 'Masquer les blocs de réflexion de l’agent dans le chat ; les réponses, outils, approbations et la progression restent visibles'],
    ['常に思考プロセスを展開', 'デフォルトでAIのエージェント思考・推論ブロックを完全に展開して表示します',
        '思考プロセスを非表示', 'チャットでエージェントの思考ブロックを非表示にします。回答・ツール・承認・進行状況は表示されたままです'],
    ['추론 항상 펼치기', '에이전트의 사고 및 추론 블록을 기본적으로 모두 펼쳐 표시합니다.',
        '추론 숨기기', '채팅에서 에이전트의 사고 블록을 숨깁니다. 답변·도구·승인·진행 상태는 그대로 표시됩니다.'],
    ['Sempre expandir raciocínio', 'Mostrar os blocos de pensamento e raciocínio do agente totalmente expandidos por padrão',
        'Ocultar raciocínio', 'Ocultar os blocos de pensamento do agente no chat; respostas, ferramentas, aprovações e progresso continuam visíveis'],
    ['Всегда разворачивать размышления', 'По умолчанию полностью разворачивать блоки размышлений и хода рассуждений агента',
        'Скрывать размышления', 'Скрывать блоки размышлений агента в чате; ответы, инструменты, подтверждения и ход работы остаются видимыми'],
    ['始终展开推理过程', '默认情况下完全展开 AI 的思考和推理过程',
        '隐藏推理过程', '在聊天中隐藏智能体的思考块；回答、工具、审批和进度仍会显示'],
];

// 설정 항목 하나의 번들 리소스 표기
function resourceEntry(key, label, description) {
    return `${key}:{label:"${escapeBundleText(label)}",description:"${escapeBundleText(description)}"}`;
}

const HIDDEN_SWITCH = '(0,u.jsx)(s.SettingsSwitch,{label:v("settings.general.hideReasoning.label"),hint:v("settings.general.hideReasoning.description"),value:x.hideReasoning,onValueChange:t=>C({hideReasoning:t})})';

const ANSWER_DESCRIPTIONS = [
    'عرض الإجابة النهائية بعد اكتمال العمل فقط؛ إخفاء التفكير والتقدم والأدوات مع إبقاء الموافقات والأخطاء',
    'Show only the final answer after completion; hide reasoning, progress and tools, keeping approvals and errors',
    'Mostrar solo la respuesta final al terminar; ocultar razonamiento, progreso y herramientas, conservando aprobaciones y errores',
    'Afficher uniquement la réponse finale après exécution ; masquer raisonnement, progression et outils, conserver autorisations et erreurs',
    '完了後の最終回答だけを表示します。推論・進行メッセージ・ツールは非表示、承認とエラーは維持します',
    '작업 완료 후 최종 답변만 표시합니다. 추론·진행 메시지·도구는 숨기고 승인 요청과 오류는 유지합니다.',
    'Mostrar apenas a resposta final após a conclusão; ocultar raciocínio, progresso e ferramentas, mantendo aprovações e erros',
    'Показывать только итоговый ответ после завершения; скрывать размышления, ход работы и инструменты, сохраняя разрешения и ошибки',
    '完成后仅显示最终回答；隐藏推理、进度消息和工具，保留审批请求和错误',
];

export const HIDE_REASONING_EDITS = [
    // 저장 기본값·스키마: 기본 꺼짐, 잘못된 저장값은 꺼짐으로 되돌린다.
    ['autoExpandReasoning:!1,toolCallDetailLevel:"detailed"', 'autoExpandReasoning:!1,hideReasoning:!1,toolCallDetailLevel:"detailed"'],
    ['autoExpandReasoning:f.z.boolean().catch(!1),', 'autoExpandReasoning:f.z.boolean().catch(!1),hideReasoning:f.z.boolean().catch(!1),'],
    // 스트림 표시 투영: 도구 묶음·레이아웃 생성 전에 중간 메시지와 숨긴 행을 제거한다.
    ['e.createStreamPresentation=function(){const l=new WeakMap;',
        `e.createStreamPresentation=function(){const l=new WeakMap,H=${answerOnlyRows.toString()};`],
    ['var j,w;return f===I&&u===_||(T=I,u.length>0&&(T=[...I,...u]),f=I,_=u),k===T&&x===s.level||(b=(0,n.prepareToolCallHistory)(s.level,T),k=T,x=s.level),(0,n.projectToolCallDetailLevel)({level:s.level,tail:T,head:o,preparedHistory:b,isTurnActive:s.isTurnActive})',
        'var j,w,y;return f===I&&u===_||(T=I,u.length>0&&(T=[...I,...u]),f=I,_=u),y=s.hideReasoning?H(T,o,s.isTurnActive):{tail:T,head:o},k===y.tail&&x===s.level||(b=(0,n.prepareToolCallHistory)(s.level,y.tail),k=y.tail,x=s.level),(0,n.projectToolCallDetailLevel)({level:s.level,tail:y.tail,head:y.head,preparedHistory:b,isTurnActive:s.isTurnActive})'],
    // 채팅 뷰: 설정을 읽고 표시 투영 메모 의존성에 새 캐시 칸(246)을 더한다.
    ['const fe=(0,h.forwardRef)(function(e,t){const n=(0,c.c)(246),', 'const fe=(0,h.forwardRef)(function(e,t){const n=(0,c.c)(247),'],
    ['Fe=(0,F.useSettings)(Ve),', 'Fe=(0,F.useSettings)(Ve),pdHideReasoning=(0,F.useSettings)(e=>!0===e.hideReasoning),'],
    ['n[59]!==Vt||n[60]!==Nt||n[61]!==Jt||n[62]!==Fe||n[63]!==nt?(Qt=$t({tail:Vt,head:Jt,transform:nt,level:Fe,isTurnActive:Nt}),n[59]=Vt,n[60]=Nt,n[61]=Jt,n[62]=Fe,n[63]=nt,n[64]=Qt)',
        'n[59]!==Vt||n[60]!==Nt||n[61]!==Jt||n[62]!==Fe||n[63]!==nt||n[246]!==pdHideReasoning?(Qt=$t({tail:Vt,head:Jt,transform:nt,level:Fe,isTurnActive:Nt,hideReasoning:pdHideReasoning}),n[59]=Vt,n[60]=Nt,n[61]=Jt,n[62]=Fe,n[63]=nt,n[246]=pdHideReasoning,n[64]=Qt)'],
    // 채팅 설정 카드: "추론 항상 펼치기" 바로 아래에 스위치를 넣고 카드는 매번 다시 만든다.
    ['h[33]!==M||h[34]!==N||h[35]!==f?(P=(0,u.jsxs)(s.SettingsCard,{children:[f,M,N]})',
        `!0?(P=(0,u.jsxs)(s.SettingsCard,{children:[f,${HIDDEN_SWITCH},M,N]})`],
    // 9개 언어 리소스
    ...LOCALES.map(([label, description, hideLabel], index) => {
        const before = resourceEntry('autoExpandReasoning', label, description);
        return [before, `${before},${resourceEntry('hideReasoning', hideLabel, ANSWER_DESCRIPTIONS[index])}`];
    }),
];

// 앞선 검토 패치의 정확한 출력만 새 패치로 정규화한 뒤 같은 원본 blob 게이트를 통과시킨다.
const PREVIOUS_EDITS = [
    ['e.createStreamPresentation=function(){const l=new WeakMap,R=new WeakMap,H=t=>{let s=R.get(t);return s||(s=t.filter(t=>"thought"!==t.kind),s=s.length===t.length?t:s,R.set(t,s)),s};', HIDE_REASONING_EDITS[2][1]],
    ['var j,w,y;return f===I&&u===_||(T=I,u.length>0&&(T=[...I,...u]),f=I,_=u),y=s.hideReasoning?H(T):T,k===y&&x===s.level||(b=(0,n.prepareToolCallHistory)(s.level,y),k=y,x=s.level),(0,n.projectToolCallDetailLevel)({level:s.level,tail:y,head:s.hideReasoning?H(o):o,preparedHistory:b,isTurnActive:s.isTurnActive})', HIDE_REASONING_EDITS[3][1]],
    ...LOCALES.map(([, , label, description], index) => [
        resourceEntry('hideReasoning', label, description),
        resourceEntry('hideReasoning', label, ANSWER_DESCRIPTIONS[index]),
    ]),
];
export const HIDE_REASONING_RESOURCE_UPDATES = PREVIOUS_EDITS.slice(2);

// 문자열 안 정확한 일치 횟수를 센다.
function occurrences(source, text) {
    return source.split(text).length - 1;
}

// 패치 지점이 모두 하나씩 있을 때만 원래 앵커로 되돌려 원본 해시 검증을 유지한다(중복·일부 적용은 실패).
export function withoutHideReasoning(source) {
    const previousCounts = PREVIOUS_EDITS.map(([before]) => occurrences(source, before));
    if (previousCounts.some((count) => count > 1)) throw new Error('Paseo hide reasoning patch drift');
    if (previousCounts.some(Boolean)) {
        if (previousCounts.some((count) => count !== 1)) throw new Error('Partial Paseo hide reasoning patch');
        source = PREVIOUS_EDITS.reduce((result, [before, after]) => result.replace(before, () => after), source);
    }
    const counts = HIDE_REASONING_EDITS.map(([, after]) => occurrences(source, after));
    if (counts.some((count) => count > 1)) throw new Error('Paseo hide reasoning patch drift');
    if (counts.includes(0) && counts.includes(1)) throw new Error('Partial Paseo hide reasoning patch');
    return HIDE_REASONING_EDITS.reduce((result, [before, after]) => result.replace(after, () => before), source);
}

// 전체 원본 해시를 통과한 번들의 유일한 앵커에만 추론 숨김 설정과 표시 필터를 붙인다.
export function withHideReasoning(source) {
    for (const [before, after] of HIDE_REASONING_EDITS) {
        if (occurrences(source, before) !== 1 || source.includes(after))
            throw new Error('Paseo hide reasoning anchor mismatch');
    }
    return HIDE_REASONING_EDITS.reduce((result, [before, after]) => result.replace(before, () => after), source);
}
