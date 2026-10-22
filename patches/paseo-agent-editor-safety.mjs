const saveBefore = 'Bt=()=>{const e={provider:$e,model:Ie,effort:De,autoEffort:Me,fast:ze,disabled:!pe,fallbacks:Oe};if("edit"===ie&&ge)return x({action:"agentSave",agent:ge,name:Te.trim()||ge,description:ke.trim(),body:Pe.trim()?Pe:`---\\nname: ${Te.trim()||ge}\\ndescription: ${ke.trim()}\\n---\\n\\nYou are the ${Te.trim()||ge} agent.\\n`,route:e}),void ft();if("create"===ie){const t=(je.trim()||Te.trim()).toLowerCase().replace(/[^a-z0-9_-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")||`agent-${Date.now()}`;x({action:"agentCreate",agent:t,name:Te.trim()||t,description:ke.trim(),body:Pe.trim()?Pe:`---\\nname: ${Te.trim()||t}\\ndescription: ${ke.trim()}\\n---\\n\\nYou are the ${Te.trim()||t} agent.\\n`,route:e}),ft()}}';
const saveAfter = 'Bt=async()=>{if(paseodogEditor.saving)return;const e={provider:$e,model:Ie,effort:De,autoEffort:Me,fast:ze,disabled:!pe,fallbacks:Oe};if("edit"===ie&&(!paseodogEditor.revision||!Pe.trim()))return;paseodogEditor.saving=!0;Ue(e=>e+1);try{if("edit"===ie&&ge){if(await x({action:"agentSave",agent:ge,expectedRevision:paseodogEditor.revision,name:Te.trim()||ge,description:ke.trim(),body:Pe,route:e}))ft()}else if("create"===ie){const t=(je.trim()||Te.trim()).toLowerCase().replace(/[^a-z0-9_-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")||`agent-${Date.now()}`;if(await x({action:"agentCreate",agent:t,name:Te.trim()||t,description:ke.trim(),body:Pe.trim()?Pe:`---\\nname: ${Te.trim()||t}\\ndescription: ${ke.trim()}\\n---\\n\\nYou are the ${Te.trim()||t} agent.\\n`,route:e}))ft()}}finally{paseodogEditor.saving=!1;Ue(e=>e+1)}}';

// 고정된 웹 에디터에도 원본 조회·revision·저장 완료 대기와 미지원 설정 숨김을 적용한다.
export const AGENT_WEB_EDITS = [
    ['s=o.z.object({id:o.z.string(),name:o.z.string(),description:o.z.string().optional(),body:o.z.string(),custom:',
        's=o.z.object({id:o.z.string(),name:o.z.string(),description:o.z.string().optional(),body:o.z.string(),revision:o.z.string().optional(),custom:'],
    [String.raw`s.set(c,f),p(f),k||w("\uc800\uc7a5\ud588\uc5b4\uc694. \uc2e4\uc2dc\uac04\uc73c\ub85c \ubc18\uc601\ub3fc\uc694.")}catch`,
        String.raw`s.set(c,f),p(f),k||w("\uc800\uc7a5\ud588\uc5b4\uc694. \uc2e4\uc2dc\uac04\uc73c\ub85c \ubc18\uc601\ub3fc\uc694.");return f}catch`],
    ['function ie(e){const t=(0,c.c)(471),{snapshot:l,disabled:s,request:x}=e,',
        'function ie(e){const t=(0,c.c)(471),{snapshot:l,disabled:paseodogDisabled,request:x}=e,'],
    ['const[Oe,Fe]=(0,u.useState)(We),[Ne,Ue]=(0,u.useState)(0);let Ge,Ke,qe,Xe,Ye;',
        'const[Oe,Fe]=(0,u.useState)(We),[Ne,Ue]=(0,u.useState)(0),paseodogEditor=(0,u.useRef)({id:null,revision:null,sequence:0,saving:!1}).current;const s=paseodogDisabled||paseodogEditor.saving||("edit"===ie&&!paseodogEditor.revision);let Ge,Ke,qe,Xe,Ye;'],
    ['qe=()=>{"edit"===ie&&ge&&l.agentDefinition',
        'qe=()=>{!1&&"edit"===ie&&ge&&l.agentDefinition'],
    ['ht=e=>{we(e.id),ve(!e.disabled)',
        'ht=async e=>{const sequence=++paseodogEditor.sequence;paseodogEditor.id=e.id;paseodogEditor.revision=null;we(e.id),ve(!e.disabled)'],
    ['fe("edit"),e.body||x({action:"agentDefinition",agent:e.id})}',
        'fe("edit");const result=await x({action:"agentDefinition",agent:e.id});if(sequence!==paseodogEditor.sequence)return;const definition=result?.agentDefinition;if(definition?.id===e.id&&definition.revision){paseodogEditor.revision=definition.revision;Le(definition.body);Ue(e=>e+1)}}'],
    ['bt=()=>{const e=l.models[0];we(null)',
        'bt=()=>{paseodogEditor.sequence++;paseodogEditor.id=null;paseodogEditor.revision=null;const e=l.models[0];we(null)'],
    ['yt=()=>{fe(null),we(null)}',
        'yt=()=>{paseodogEditor.sequence++;paseodogEditor.id=null;paseodogEditor.revision=null;fe(null),we(null)}'],
    [saveBefore, saveAfter],
    ['children:[wl,pl,Cl,Ll]', 'children:[(0,C.jsx)(o.Text,{children:"자동 Worktree 격리는 아직 지원하지 않습니다. 기존 작업 폴더에서 실행됩니다."}),Ll]'],
    [String.raw`title:"Git Worktree \ubc0f \uc2e4\ud589 \uc258"`, String.raw`title:"\uc2e4\ud589 \uc258"`],
];

// 전체 blob 검사 전에 이 패치만 역순으로 제거한다.
export function withoutAgentEditorSafety(source) {
    const counts = AGENT_WEB_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Paseo agent editor safety patch drift');
    if (counts.includes(0) && counts.some((count) => count > 0)) throw new Error('Partial Paseo agent editor safety patch');
    for (const [before, after] of [...AGENT_WEB_EDITS].reverse()) source = source.replace(after, () => before);
    return source;
}

// 고정 원본의 단일 앵커만 바꿔 다른 화면은 보존한다.
export function withAgentEditorSafety(source) {
    for (const [before, after] of AGENT_WEB_EDITS) {
        if (source.split(before).length !== 2) throw new Error('Paseo agent editor safety anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
