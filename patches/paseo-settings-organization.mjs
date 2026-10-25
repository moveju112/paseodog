import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

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
const engineAnchor = '_e.AiEnginePage=function(e){';
const engineWrapper = `_e.AiEnginePage=function(e){return u.createElement(n.View,{style:{gap:16}},u.createElement(PaseodogBaseAiEnginePage,e),e.section==="workflow"?u.createElement(PaseodogTurnDurationSettings,{key:"duration:"+e.serverId,serverId:e.serverId}):null,e.section==="workflow"?u.createElement(PaseodogAgentMessageSettings,{key:e.serverId,serverId:e.serverId}):null)};function PaseodogBaseAiEnginePage(e){`;
const wrappedDiagnostics = `${details}function Me(e){const section=PaseodogBaseDiagnostics(e),card=section.props.children,rows=card.props.children;return c.cloneElement(section,{},c.cloneElement(card,{},...rows.slice(0,-1),c.createElement(PaseodogDiagnosticDetails,{serverId:e.serverId},rows.at(-1))))}function PaseodogBaseDiagnostics(e){const n=(0,l.c)(53)`;
const edits = [
    [engineAnchor, engineWrapper],
    ['const k=[{value:"none",label:', `${messageComponent}${durationComponent}const k=[{value:"none",label:`],
    ['children:[pe,Te,ke,Ve]', 'children:[pe,...(Q?.enabled?[Te,ke,Ve]:[])]'],
    ['handlePlaybackTest:Se});case"about"', 'handlePlaybackTest:Se,serverId:ge});case"about"'],
    [originalDiagnostics, wrappedDiagnostics],
];

export function withoutSettingsOrganization(source) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}

export function withSettingsOrganization(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo settings organization anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
