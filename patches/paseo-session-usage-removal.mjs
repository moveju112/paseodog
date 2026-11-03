// 고정 upstream 번들에서 목록 렌더러·조회 스키마·호출을 함께 제거한다.
// 역변환은 검토된 전체 원본 blob 검증에만 쓰이며 기능을 다시 배포하지 않는다.
const renderers = 'function fe(e){const t=(0,c.c)(4),{sessions:l}=e;let s,r;return t[0]!==l?(s=0===l.length?(0,C.jsx)(n.View,{style:S.settingsStyles.row,children:(0,C.jsx)(o.Text,{style:S.settingsStyles.rowHint,children:"\\ud604\\uc7ac \\uba54\\ubaa8\\ub9ac\\uc5d0 \\uc5f4\\ub9b0 \\uc5d4\\uc9c4 \\uc138\\uc158\\uc774 \\uc5c6\\uc5b4\\uc694."})}):l.map(ge),t[0]=l,t[1]=s):s=t[1],t[2]!==s?(r=(0,C.jsx)(b.SettingsSection,{title:"\\uc5f4\\ub9b0 \\uc138\\uc158 \\ucee8\\ud14d\\uc2a4\\ud2b8 \\uc0ac\\uc6a9\\ub7c9",children:(0,C.jsx)(n.View,{style:S.settingsStyles.card,children:s})}),t[2]=s,t[3]=r):r=t[3],r}'
    + 'function ge(e){return(0,C.jsx)(I,{title:e.model||"\\uc5f4\\ub9b0 \\uc138\\uc158",hint:e.id,children:(0,C.jsx)(o.Text,{style:S.settingsStyles.rowTitle,children:(t=e.context?.usedTokens,void 0===t?"\\ud655\\uc778 \\ub300\\uae30":`${Math.round(t).toLocaleString()} \\ud1a0\\ud070`)})},e.id);var t}';
const edits = [
    [`${renderers}function we(e){const t=(0,c.c)(104)`, 'function we(e){const t=(0,c.c)(101)'],
    ['let ke,Ve,Pe,Le,$e;', 'let ke,Ve,Pe,$e;'],
    [
        't[98]!==l.sessions?(Le=(0,C.jsx)(fe,{sessions:l.sessions}),t[98]=l.sessions,t[99]=Le):Le=t[99],t[100]!==we||t[101]!==Pe||t[102]!==Le?($e=(0,C.jsxs)(C.Fragment,{children:[we,Pe,Le]}),t[100]=we,t[101]=Pe,t[102]=Le,t[103]=$e):$e=t[103]',
        't[98]!==we||t[99]!==Pe?($e=(0,C.jsxs)(C.Fragment,{children:[we,Pe]}),t[98]=we,t[99]=Pe,t[100]=$e):$e=t[100]',
    ],
    [
        'minContextPercent:o.z.number()}).optional(),sessions:o.z.array(o.z.object({id:o.z.string(),model:o.z.string().optional(),state:o.z.string().optional(),compaction:o.z.object({auto:o.z.boolean()}).optional(),context:o.z.record(o.z.string(),o.z.number()).optional()}))})},4684,[3130]);',
        'minContextPercent:o.z.number()}).optional()})},4684,[3130]);',
    ],
];

export function withSessionUsageRemoved(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo session usage removal anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}

export function withoutSessionUsageRemoved(source) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}
