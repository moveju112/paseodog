import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { withSessionUsageRemoved, withoutSessionUsageRemoved } from './paseo-session-usage-removal.mjs';

// 음성인식 제거 전 릴리즈가 넣은 설정 화면만 걷어내며 새로 적용하지 않는다.
const legacySpeechComponents = new Set([
    'a047a6384588c337a2d01416fe7b61174b888822b19a587c69bb3cba069416b5',
    'e5023d4423d17b844bd29e740c32acb7041008d17fccb40ccb72e1b0687bd2f2',
    '7c5147f49c4d8fcd9838c3926d68e37e1636a39a2fc177db4c2aa5ead4749a3a',
]);
const legacySpeechPattern = /const PaseodogSpeechSettings=\(\(\)=>\{[\s\S]*?;return SpeechSettings\}\)\(\);/g;
const legacySpeechRow = 'e.section==="workflow"?u.createElement(PaseodogSpeechSettings,{key:"speech:"+e.serverId,serverId:e.serverId}):null,';

export function withoutLegacySpeechSettings(source) {
    const components = [...source.matchAll(legacySpeechPattern)];
    const rows = source.split(legacySpeechRow).length - 1;
    if (components.length > 1 || rows > 1 || components.length !== rows)
        throw new Error('Partial previous speech settings patch');
    if (!components.length) return source;
    if (!legacySpeechComponents.has(createHash('sha256').update(components[0][0]).digest('hex')))
        throw new Error('Speech settings source hash mismatch');
    return source.replace(components[0][0], () => '').replace(legacySpeechRow, () => '');
}

// 배포된 구버전 UI만 검토된 해시로 걷어낸다. 제거된 기능의 구현은 다시 포함하지 않는다.
const removedSettings = [
    {
        name: 'computer',
        pattern: /const PaseodogComputerUseSettings=\(\(\)=>\{[\s\S]*?;return ComputerUseSettings\}\)\(\);/g,
        hash: '98c684817d8c564552e8a6f906b76c9d5882974befdbd5c42d09bca36a692670',
        row: 'e.section==="tools"?u.createElement(PaseodogComputerUseSettings,{key:"computer:"+e.serverId,serverId:e.serverId}):null,',
    },
    {
        name: 'session message',
        pattern: /const PaseodogAgentMessageSettings=\(\(\)=>\{[\s\S]*?;return AgentMessageSettings\}\)\(\);/g,
        hash: '8c3f471af0e4fa2bd2bad0a5aa481a6adcf178d604a24ae934bce54575a517ad',
        row: ',e.section==="workflow"?u.createElement(PaseodogAgentMessageSettings,{key:e.serverId,serverId:e.serverId}):null',
    },
];

function withoutRemovedSettings(source) {
    for (const { name, pattern, hash, row } of removedSettings) {
        const components = [...source.matchAll(pattern)];
        const rows = source.split(row).length - 1;
        if (components.length > 1 || rows > 1 || components.length !== rows)
            throw new Error(`Partial previous ${name} settings patch`);
        if (!components.length) continue;
        if (createHash('sha256').update(components[0][0]).digest('hex') !== hash)
            throw new Error(`Previous ${name} settings source hash mismatch`);
        source = source.replace(components[0][0], () => '').replace(row, () => '');
    }
    return source;
}

// 앱과 고정 웹 번들이 같은 상세 UI를 사용하며 기존 진단·재생 동작은 유지한다.
const detailsSource = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/diagnostic-details.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const details = `const PaseodogDiagnosticDetails=(()=>{const {createElement,useCallback,useState}=c,{Text}=s,{View}=t,{useRouter}=p,{Button}=q,{useInstalledPlugins}=he,{buildPluginSurfaceRoute}=r(3893),{useHostRuntimeIsConnected}=L,{settingsStyles}=ae;${detailsSource};return DiagnosticDetails})();`;
const originalDiagnostics = 'function Me(e){const n=(0,l.c)(53)';
const durationSource = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/turn-duration-settings.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const durationComponent = `const PaseodogTurnDurationSettings=(()=>{const {createElement,useCallback,useEffect,useRef,useState}=u,{View}=n,{Text}=o,{Pressable}=r,{AdaptiveTextInput}=_r(3930),{settingsStyles}=S,{useHostRuntimeClient,useHostRuntimeIsConnected}=_r(3762);${durationSource};return TurnDurationSettings})();`;
const engineAnchor = '_e.AiEnginePage=function(e){';
const engineWrapper = `_e.AiEnginePage=function(e){return u.createElement(n.View,{style:{gap:16}},u.createElement(PaseodogBaseAiEnginePage,e),e.section==="workflow"?u.createElement(PaseodogTurnDurationSettings,{key:"duration:"+e.serverId,serverId:e.serverId}):null)};function PaseodogBaseAiEnginePage(e){`;
const durationRow = ',e.section==="workflow"?u.createElement(PaseodogTurnDurationSettings,{key:"duration:"+e.serverId,serverId:e.serverId}):null';
const previousEngineWrapper = `_e.AiEnginePage=function(e){return u.createElement(n.View,{style:{gap:16}},u.createElement(PaseodogBaseAiEnginePage,e))};function PaseodogBaseAiEnginePage(e){`;
const wrappedDiagnostics = `${details}function Me(e){const section=PaseodogBaseDiagnostics(e),card=section.props.children,rows=card.props.children;return c.cloneElement(section,{},c.cloneElement(card,{},...rows.slice(0,-1),c.createElement(PaseodogDiagnosticDetails,{serverId:e.serverId},rows.at(-1))))}function PaseodogBaseDiagnostics(e){const n=(0,l.c)(53)`;
const edits = [
    [engineAnchor, engineWrapper],
    ['const k=[{value:"none",label:', `${durationComponent}const k=[{value:"none",label:`],
    ['children:[pe,Te,ke,Ve]', 'children:[pe,...(Q?.enabled?[Te,ke,Ve]:[])]'],
    ['handlePlaybackTest:Se});case"about"', 'handlePlaybackTest:Se,serverId:ge});case"about"'],
    [originalDiagnostics, wrappedDiagnostics],
    [
        'outputFields:["agentId","status","currentModeId","cwd"]},send_agent_prompt:{promptField:"prompt",inputOrder:n,outputFields:["status","lastMessage","permission"]},get_agent_status:',
        'outputFields:["agentId","status","currentModeId","cwd"]},get_agent_status:',
    ],
];

export function withoutSettingsOrganization(source) {
    source = withoutSessionUsageRemoved(withoutRemovedSettings(withoutLegacySpeechSettings(source)));
    const components = source.split(durationComponent).length - 1;
    const rows = source.split(durationRow).length - 1;
    if (components > 1 || rows > 1 || components !== rows)
        throw new Error('Partial previous duration settings patch');
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    // 실행 시간 설정이 없던 구버전 wrapper도 전체 원본 blob 검증 아래에서만 해제한다.
    if (source.includes(previousEngineWrapper))
        source = source.replace(previousEngineWrapper, () => engineAnchor);
    return source;
}

export function withSettingsOrganization(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo settings organization anchor mismatch');
        source = source.replace(before, () => after);
    }
    return withSessionUsageRemoved(source);
}
