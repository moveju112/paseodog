import { createInterruptConfirmation } from '../android/packages/app/src/composer/interrupt-confirmation.ts';

const marker = '/*PaseoDog composer controls*/';
const moduleAnchor = '_e.Composer=function(e){const n=(0,u.c)(8);';
const boundary = '\n__d(';

const voiceSlot = 'function lt(t){const n=(0,u.c)(10);let o,c,d,p,h,b,f;if(n[0]!==t){var C=t;({isVoiceModeForAgent:h,hasAgent:o,isAgentRunning:d,hasSendableContent:c,isCompact:p,showVoice:b}=C),f=(0,s.default)(C,e),n[0]=t,n[1]=o,n[2]=c,n[3]=d,n[4]=p,n[5]=h,n[6]=b,n[7]=f}else o=n[1],c=n[2],d=n[3],p=n[4],h=n[5],b=n[6],f=n[7];if(!(b&&!h&&o&&!d&&!(p&&c)))return null;let x;return n[8]!==f?(x=(0,we.jsx)(l.View,{style:pt.rightControls,children:(0,we.jsx)(ut,Object.assign({},f))}),n[8]=f,n[9]=x):x=n[9],x}';
const voiceButton = 'function ut(e){const t=(0,u.c)(23),{buttonIconSize:n,handleToggleRealtimeVoice:s,isConnected:c,isVoiceSwitching:d,realtimeVoiceButtonStyle:p,voiceToggleKeys:h,t:f}=e;let C;t[0]!==h?(C=h?(0,we.jsx)(q.Shortcut,{chord:h}):null,t[0]=h,t[1]=C):C=t[1];const x=C;let S;t[2]!==n||t[3]!==d?(S=e=>{const{hovered:t}=e;if(d)return(0,we.jsx)(b.LoadingSpinner,{size:"small",color:"white"});const s=t?kt:wt;return(0,we.jsx)(St,{size:n,uniProps:s})},t[2]=n,t[3]=d,t[4]=S):S=t[4];const A=S,I=!c||d;let v,y,k,w,R,F;return t[5]!==f?(v=f("composer.voice.enableVoiceMode"),t[5]=f,t[6]=v):v=t[6],t[7]!==s||t[8]!==p||t[9]!==A||t[10]!==I||t[11]!==v?(y=(0,we.jsx)(V.TooltipTrigger,{onPress:s,disabled:I,accessibilityLabel:v,accessibilityRole:"button",style:p,children:A}),t[7]=s,t[8]=p,t[9]=A,t[10]=I,t[11]=v,t[12]=y):y=t[12],t[13]!==f?(k=f("composer.voice.voiceMode"),t[13]=f,t[14]=k):k=t[14],t[15]!==k?(w=(0,we.jsx)(o.Text,{style:pt.tooltipText,children:k}),t[15]=k,t[16]=w):w=t[16],t[17]!==x||t[18]!==w?(R=(0,we.jsx)(V.TooltipContent,{side:"top",align:"center",offset:8,children:(0,we.jsxs)(l.View,{style:pt.tooltipRow,children:[w,x]})}),t[17]=x,t[18]=w,t[19]=R):R=t[19],t[20]!==y||t[21]!==R?(F=(0,we.jsxs)(V.Tooltip,{delayDuration:0,enabledOnDesktop:!0,enabledOnMobile:!1,children:[y,R]}),t[20]=y,t[21]=R,t[22]=F):F=t[22],F}';

// 검토 번들의 기존 확인창·세션 선택자를 재사용하고 중단 버튼의 직접 동작은 유지한다.
const keyboardInterrupt = `function requestPaseodogKeyboardInterrupt(guard,cancel,serverId,agentRef,t,reportError){
    if(se.isNative){cancel();return}
    const agentId=agentRef.current;
    const target=j.selectAgentTurnPresentation(j.useSessionStore.getState().sessions[serverId],agentId);
    void guard({
        confirm:()=>r(3773).confirmDialog({
            title:t("composer.cancel.confirmTitle"),message:t("composer.cancel.confirmMessage"),
            confirmLabel:t("composer.cancel.interrupt"),cancelLabel:t("common.actions.cancel"),destructive:true
        }),
        isCurrent:()=>{
            const current=j.selectAgentTurnPresentation(j.useSessionStore.getState().sessions[serverId],agentId);
            return agentRef.current===agentId&&current.isActive&&!current.isCancelling&&current.turnId===target.turnId
        },
        interrupt:cancel,
        reportError:error=>{const message=Ke(error);if(message&&message.trim().length>0)reportError(message)}
    })
}`;

export const COMPOSER_CONTROL_EDITS = [
    ['const e=["isVoiceModeForAgent","hasAgent","isAgentRunning","hasSendableContent","isCompact","showVoice"],t=["isPaneFocused"];',
        marker + 'const t=["isPaneFocused"];' + createInterruptConfirmation.toString() + keyboardInterrupt],
    ['function Te(e,t,n){return e?.isVoiceModeForAgent(t,n)??!1}function Le(', 'function Le('],
    ['function Ve(e,t,n){const s=e?pt.iconButtonHovered:void 0,o=t?pt.buttonDisabled:void 0,c=n?pt.realtimeVoiceButtonCompactReserve:void 0;return[pt.realtimeVoiceButton,c,s,o].filter(e=>Boolean(e))}function qe(', 'function qe('],
    ['function $e(e){const{voice:t,isConnected:n,hasAgent:s,serverId:o,agentId:c,toastErrorRef:l}=e;t&&n&&s&&(t.isVoiceSwitching||t.isVoiceModeForAgent(o,c)||t.startVoice(o,c).catch(e=>{console.error("[Composer] Failed to start voice mode",e);const t=Ke(e);t&&t.trim().length>0&&l.current(t)}))}function He(', 'function He('],
    [voiceSlot + voiceButton + 'const dt=(0,C.memo)(mt);', 'const dt=(0,C.memo)(mt);'],
    ['const Mt=(0,D.useVoiceOptional)(),Pt=(0,W.useShortcutKeys)("voice-toggle"),_t=',
        'const paseodogInterruptConfirmation=(0,C.useMemo)(createInterruptConfirmation,[]),_t='],
    [',hs=Te(Mt,t,e),bs=(0,C.useCallback)(()=>{$e({voice:Mt,isConnected:kt,hasAgent:es,serverId:t,agentId:e,toastErrorRef:jt})},[e,es,kt,t,Mt]),fs=', ',fs='],
    [',Ss=zt||Ht.length>0,As=', ',As='],
    [',zt=(0,C.useSyncExternalStore)(q.subscribe,()=>q.getSnapshot().trim().length>0,()=>q.getSnapshot().trim().length>0),Kt=', ',Kt='],
    [',vs=Mt?.isVoiceSwitching??!1,ys=!kt||vs,ks=(0,C.useCallback)(e=>Ve(e.hovered,ys,Vt),[Vt,ys]),ws=', ',ws='],
    [',Rs=(0,C.useMemo)(()=>(0,we.jsx)(lt,{isVoiceModeForAgent:hs,hasAgent:es,isAgentRunning:Jn,hasSendableContent:Ss,isCompact:Vt,showVoice:Ct.showVoice,buttonIconSize:St,handleToggleRealtimeVoice:bs,isConnected:kt,isVoiceSwitching:vs,realtimeVoiceButtonStyle:ks,voiceToggleKeys:Pt,t:xt}),[St,bs,es,Ss,Jn,kt,Vt,hs,vs,Ct.showVoice,ks,xt,Pt]),Fs=', ',Fs='],
    [',rightContent:Rs,activeActionContent:', ',activeActionContent:'],
    ['rightControls:{flexDirection:"row",alignItems:"center",gap:e.spacing[1],uni__dependencies:[0]},contextWindowMeterSlot:', 'contextWindowMeterSlot:'],
    ['realtimeVoiceButton:{width:28,height:28,borderRadius:e.borderRadius.full,alignItems:"center",justifyContent:"center",uni__dependencies:[0]},realtimeVoiceButtonCompactReserve:{marginLeft:e.spacing[1],uni__dependencies:[0]},realtimeVoiceButtonActive:{backgroundColor:e.colors.palette.green[600],borderColor:e.colors.palette.green[800],uni__dependencies:[0]},iconButtonHovered:{backgroundColor:e.colors.surface2,uni__dependencies:[0]},attachmentTray:', 'attachmentTray:'],
    [',St=(0,S.withUnistyles)(y.AudioLines),At=', ',At='],
    ['(0,we.jsx)(Ze,{handlerId:On.current,messageInputRef:Pn,isAgentRunning:Jn,isCancellingAgent:Gn,isConnected:kt,handleCancelAgent:gs,',
        '(0,we.jsx)(Ze,{handlerId:On.current,messageInputRef:Pn,isAgentRunning:Jn,isCancellingAgent:Gn,isConnected:kt,handleCancelAgent:()=>requestPaseodogKeyboardInterrupt(paseodogInterruptConfirmation,gs,t,Wn,xt,jt.current),'],
];

const dialogCopies = {
    'توقف الوكيل': ['إيقاف الوكيل؟', 'سيتوقف تشغيل الوكيل الحالي. سيتم الاحتفاظ بمسودتك.'],
    'Stop agent': ['Stop the agent?', 'The current agent run will stop. Your draft will be kept.'],
    'detener agente': ['¿Detener al agente?', 'Se detendrá la ejecución actual del agente. Se conservará tu borrador.'],
    'Arrêter l’agent': ['Arrêter l’agent ?', 'L’exécution en cours de l’agent sera arrêtée. Votre brouillon sera conservé.'],
    'エージェントを停止': ['エージェントを停止しますか？', '実行中のエージェントを停止します。入力中の下書きは保持されます。'],
    '에이전트 중지': ['에이전트를 중단할까?', '실행 중인 작업이 중단돼. 입력 중인 내용은 그대로 유지돼.'],
    'Parar agente': ['Parar o agente?', 'A execução atual do agente será interrompida. Seu rascunho será mantido.'],
    'Остановить агента': ['Остановить агента?', 'Текущее выполнение агента будет остановлено. Ваш черновик сохранится.'],
    '停止 Agent': ['停止 Agent？', '将停止 Agent 当前的运行。你正在输入的草稿会保留。'],
};
const literal = '"(?:\\\\.|[^"\\\\])*"';
const dialogPattern = new RegExp(`cancel:\\{cancelingAgent:(${literal}),stopAgent:(${literal}),interrupt:(${literal})(?:,confirmTitle:${literal},confirmMessage:${literal})?\\}`, 'g');

function dialogEdits(source) {
    const matches = [...source.matchAll(dialogPattern)];
    if (matches.length !== 9) throw new Error('Paseo interrupt dialog locale anchor mismatch');
    return matches.map((match) => {
        // Metro의 JavaScript 문자열은 JSON에 없는 \xNN 이스케이프도 사용한다.
        const copy = dialogCopies[JSON.parse(match[2].replace(/\\x([0-9a-f]{2})/gi, '\\u00$1'))];
        if (!copy) throw new Error('Paseo interrupt dialog locale mismatch');
        const before = `cancel:{cancelingAgent:${match[1]},stopAgent:${match[2]},interrupt:${match[3]}}`;
        return [before, before.slice(0, -1) + `,confirmTitle:${JSON.stringify(copy[0])},confirmMessage:${JSON.stringify(copy[1])}}`];
    });
}

function changeComposerModule(source, reverse) {
    const at = source.indexOf(moduleAnchor);
    if (at < 0) throw new Error('Paseo composer controls module anchor mismatch');
    const start = source.lastIndexOf(boundary, at);
    const next = source.indexOf(boundary, at);
    const end = next < 0 ? source.length : next;
    let module = source.slice(start, end);
    const edits = reverse ? [...COMPOSER_CONTROL_EDITS].reverse() : COMPOSER_CONTROL_EDITS;
    for (const [before, after] of edits) {
        const from = reverse ? after : before;
        if (module.split(from).length !== 2 || (reverse && module.includes(before)))
            throw new Error('Partial Paseo composer controls patch or anchor mismatch');
        module = module.replace(from, () => reverse ? before : after);
    }
    return source.slice(0, start) + module + source.slice(end);
}

export function withComposerControls(source) {
    if (source.includes(marker)) throw new Error('Paseo composer controls already applied');
    const edits = dialogEdits(source);
    source = changeComposerModule(source, false);
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo interrupt dialog anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}

export function withoutComposerControls(source) {
    if (!source.includes(marker)) return source;
    if (source.split(marker).length !== 2) throw new Error('Partial Paseo composer controls patch');
    for (const [before, after] of dialogEdits(source)) {
        if (source.split(after).length !== 2 || source.includes(before))
            throw new Error('Partial Paseo interrupt dialog patch');
        source = source.replace(after, () => before);
    }
    return changeComposerModule(source, true);
}
