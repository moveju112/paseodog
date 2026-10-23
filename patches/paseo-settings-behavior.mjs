// 공통 앱과 고정 웹 번들에 동일한 저장 성공 경계·오류 표시·훅 revision 계약을 적용한다.
const saveError = '설정을 저장하지 못했어요. 이전 설정을 유지했어요. 저장 공간·권한을 확인하고 다시 변경해 주세요.';
const saveBefore = '_e.saveAppSettings=async function(e){const t=V(e.queryClient.getQueryData(F)??await Q(e.deps)),n="function"==typeof e.updates?e.updates(t):e.updates,o=Object.assign({},t,n);e.queryClient.setQueryData(F,o),await re(e.deps.storage,await ie(e.deps.storage,h.APP_SETTINGS_KEY)??J.parse({}),o)}';
const saveAfter = `_e.saveAppSettings=(()=>{const pendingSaves=new WeakMap;return function(e){const save=async()=>{try{const t=V(e.queryClient.getQueryData(F)??await Q(e.deps)),n="function"==typeof e.updates?e.updates(t):e.updates,o=V(Object.assign({},t,n));await re(e.deps.storage,await ie(e.deps.storage,h.APP_SETTINGS_KEY)??J.parse({}),o);e.queryClient.setQueryData(F,o);e.queryClient.setQueryData(["app-settings-save-error"],null)}catch(error){e.queryClient.setQueryData(["app-settings-save-error"],${JSON.stringify(saveError)});throw error}};const result=(pendingSaves.get(e.queryClient)??Promise.resolve()).then(save);pendingSaves.set(e.queryClient,result.catch(()=>{}));return result}})()`;
const edits = [
    [saveBefore, saveAfter],
    ['_e.saveAppSettings=O,_e.loadAppSettingsFromStorage=p,',
        '_e.useAppSettingsSaveError=function(){return(0,_.useQuery)({queryKey:["app-settings-save-error"],queryFn:()=>null,initialData:null,staleTime:1/0,gcTime:1/0}).data},_e.saveAppSettings=O,_e.loadAppSettingsFromStorage=p,'],
    ['l=async e=>{try{await O({queryClient:n,updates:e})}catch(e){const t=e;throw console.error("[AppSettings] Failed to save settings:",t),t}}',
        'l=e=>{const pending=O({queryClient:n,updates:e});pending.catch(()=>{});return pending}'],
    ['N=async()=>{try{const e=Object.assign({},T.DEFAULT_CLIENT_SETTINGS);n.setQueryData(T.APP_SETTINGS_QUERY_KEY,e),await s.default.setItem(T.APP_SETTINGS_KEY,JSON.stringify(e))}catch(e){const t=e;throw console.error("[AppSettings] Failed to reset settings:",t),t}}',
        'N=()=>{const pending=O({queryClient:n,updates:()=>Object.assign({},T.DEFAULT_CLIENT_SETTINGS)});pending.catch(()=>{});return pending}'],
    ['function it({view:e,openAddHostIntent:o=null})',
        'function paseodogSaveError(){const error=(0,A.useAppSettingsSaveError)();return error?(0,Pe.jsx)(s.Text,{accessibilityRole:"alert",style:ae.settingsStyles.rowError,children:error}):null}function it({view:e,openAddHostIntent:o=null})'],
    ['title:Ye,onBack:$e,children:Ze', 'title:Ye,onBack:$e,children:[(0,Pe.jsx)(paseodogSaveError,{},"settings-save-error"),Ze]'],
    ['title:Ye,titleTestID:"settings-detail-header-title",children:Ze',
        'title:Ye,titleTestID:"settings-detail-header-title",children:[(0,Pe.jsx)(paseodogSaveError,{},"settings-save-error"),Ze]'],
    ['index:o.z.number(),event:o.z.string(),matcher:o.z.string().optional(),command:o.z.string(),enabled:o.z.boolean()',
        'index:o.z.number(),revision:o.z.string().optional(),event:o.z.string(),matcher:o.z.string().optional(),command:o.z.string(),enabled:o.z.boolean()'],
    ['hookAction:"toggle",hookIndex:e.index,enabled:t', 'hookAction:"toggle",hookIndex:e.index,hookRevision:e.revision,enabled:t'],
    ['hookAction:"delete",hookIndex:e.index}', 'hookAction:"delete",hookIndex:e.index,hookRevision:e.revision}'],
    ['accessibilityLabel:`\\ud6c5 ${e.index}`,disabled:s,value:e.enabled',
        'accessibilityLabel:`\\ud6c5 ${e.index}`,disabled:s||!e.revision,value:e.enabled'],
    ['variant:"ghost",disabled:s,onPress:()=>{r({action:"preferences",hookAction:"delete"',
        'variant:"ghost",disabled:s||!e.revision,onPress:()=>{r({action:"preferences",hookAction:"delete"'],
    [String.raw`\uc0c8 \ub77c\uc774\ud504\uc0ac\uc774\ud074 \ud6c5 \ucd94\uac00`,
        String.raw`\uc0c8 \ub77c\uc774\ud504\uc0ac\uc774\ud074 \ud6c5 \ucd94\uac00 (\uc800\uc7a5 \ud6c4 \uc9c1\uc811 \ucf1c\uae30)`],
    ['O=()=>{p.trim()&&(r({action:"preferences",hookAction:"add",hookRule:Object.assign({event:y,command:p.trim()},T.trim()?{matcher:T.trim()}:{})}),v(""),k(""),x(!1))}',
        'O=async()=>{if(p.trim()&&await r({action:"preferences",hookAction:"add",hookRule:Object.assign({event:y,command:p.trim()},T.trim()?{matcher:T.trim()}:{})})){v("");k("");x(!1)}}'],
];

export function withoutSettingsBehavior(source) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, before);
    return source;
}

export function withSettingsBehavior(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error(`Paseo settings behavior anchor mismatch: ${before.slice(0, 90)}`);
        source = source.replace(before, after);
    }
    return source;
}
