import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

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

// 앱과 고정 웹 번들이 같은 상세 UI를 사용하며 기존 진단·재생 동작은 유지한다.
const detailsSource = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/diagnostic-details.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const details = `const PaseodogDiagnosticDetails=(()=>{const {createElement,useCallback,useState}=c,{Text}=s,{View}=t,{useRouter}=p,{Button}=q,{useInstalledPlugins}=he,{buildPluginSurfaceRoute}=r(3893),{useHostRuntimeIsConnected}=L,{settingsStyles}=ae;${detailsSource};return DiagnosticDetails})();`;
const originalDiagnostics = 'function Me(e){const n=(0,l.c)(53)';
const messageSource = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/agent-message-settings.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const messageComponent = `const PaseodogAgentMessageSettings=(()=>{const {createElement,useCallback,useEffect,useRef,useState}=u,{View}=n,{Text}=o,{Pressable}=r,{settingsStyles}=S,{useHostRuntimeClient,useHostRuntimeIsConnected}=_r(3762);${messageSource};return AgentMessageSettings})();`;
const durationSource = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/turn-duration-settings.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const durationComponent = `const PaseodogTurnDurationSettings=(()=>{const {createElement,useCallback,useEffect,useRef,useState}=u,{View}=n,{Text}=o,{Pressable}=r,{AdaptiveTextInput}=_r(3930),{settingsStyles}=S,{useHostRuntimeClient,useHostRuntimeIsConnected}=_r(3762);${durationSource};return TurnDurationSettings})();`;
const computerSource = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/computer-use-settings.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const computerComponent = `const PaseodogComputerUseSettings=(()=>{const {createElement,useCallback,useEffect,useRef,useState}=u,{View}=n,{Text}=o,{Pressable}=r,{Switch}=w,{settingsStyles}=S,{useHostRuntimeClient,useHostRuntimeIsConnected}=_r(3762),{openExternalUrl}=_r(3916);${computerSource};return ComputerUseSettings})();`;
const computerRow = 'e.section==="tools"?u.createElement(PaseodogComputerUseSettings,{key:"computer:"+e.serverId,serverId:e.serverId}):null,';
const engineAnchor = '_e.AiEnginePage=function(e){';
const engineWrapper = `_e.AiEnginePage=function(e){return u.createElement(n.View,{style:{gap:16}},u.createElement(PaseodogBaseAiEnginePage,e),e.section==="workflow"?u.createElement(PaseodogTurnDurationSettings,{key:"duration:"+e.serverId,serverId:e.serverId}):null,e.section==="workflow"?u.createElement(PaseodogAgentMessageSettings,{key:e.serverId,serverId:e.serverId}):null)};function PaseodogBaseAiEnginePage(e){`;
const previousEngineWrapper = `_e.AiEnginePage=function(e){return u.createElement(n.View,{style:{gap:16}},u.createElement(PaseodogBaseAiEnginePage,e),e.section==="workflow"?u.createElement(PaseodogAgentMessageSettings,{key:e.serverId,serverId:e.serverId}):null)};function PaseodogBaseAiEnginePage(e){`;
const wrappedDiagnostics = `${details}function Me(e){const section=PaseodogBaseDiagnostics(e),card=section.props.children,rows=card.props.children;return c.cloneElement(section,{},c.cloneElement(card,{},...rows.slice(0,-1),c.createElement(PaseodogDiagnosticDetails,{serverId:e.serverId},rows.at(-1))))}function PaseodogBaseDiagnostics(e){const n=(0,l.c)(53)`;
const edits = [
    [engineAnchor, engineWrapper],
    ['const k=[{value:"none",label:', `${messageComponent}${durationComponent}const k=[{value:"none",label:`],
    ['children:[pe,Te,ke,Ve]', 'children:[pe,...(Q?.enabled?[Te,ke,Ve]:[])]'],
    ['handlePlaybackTest:Se});case"about"', 'handlePlaybackTest:Se,serverId:ge});case"about"'],
    [originalDiagnostics, wrappedDiagnostics],
    // 기존 삽입 뒤에 덧붙여 컴퓨터 사용 이전 릴리즈도 같은 순서로 해제·재적용된다.
    ['const PaseodogAgentMessageSettings=', `${computerComponent}const PaseodogAgentMessageSettings=`],
    ['u.createElement(PaseodogBaseAiEnginePage,e),', `u.createElement(PaseodogBaseAiEnginePage,e),${computerRow}`],
];

export function withoutSettingsOrganization(source) {
    source = withoutLegacySpeechSettings(source);
    const computerComponents = source.split(computerComponent).length - 1;
    const computerRows = source.split(computerRow).length - 1;
    if (computerComponents > 1 || computerRows > 1 || computerComponents !== computerRows)
        throw new Error('Partial computer settings organization patch');
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    // 직전 릴리즈의 두 삽입 지점이 모두 일치할 때만 해제한다. 최종 원본 blob 검증은 유지한다.
    const previousComponent = `${messageComponent}const k=[{value:"none",label:`;
    if (source.includes(previousEngineWrapper) || source.includes(previousComponent)) {
        if (source.split(previousEngineWrapper).length !== 2 || source.split(previousComponent).length !== 2)
            throw new Error('Partial previous settings organization patch');
        source = source.replace(previousEngineWrapper, () => engineAnchor)
            .replace(previousComponent, () => 'const k=[{value:"none",label:');
    }
    return source;
}

export function withSettingsOrganization(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo settings organization anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
