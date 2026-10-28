import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/speech-settings.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const component = `const PaseodogSpeechSettings=(()=>{const {createElement,useCallback,useEffect,useRef,useState}=u,{View}=n,{Text}=o,{Pressable}=r,{settingsStyles}=S,{useHostRuntimeClient,useHostRuntimeIsConnected}=_r(3762);${source};return SpeechSettings})();`;
const edits = [
    ['const PaseodogAgentMessageSettings=', component + 'const PaseodogAgentMessageSettings='],
    ['u.createElement(PaseodogBaseAiEnginePage,e),',
        'u.createElement(PaseodogBaseAiEnginePage,e),e.section==="workflow"?u.createElement(PaseodogSpeechSettings,{key:"speech:"+e.serverId,serverId:e.serverId}):null,'],
];

export function withoutSpeechSettings(source) {
    const present = edits.map(([, after]) => source.includes(after));
    if (present.some(Boolean) && !present.every(Boolean)) throw new Error('Partial speech settings patch');
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}

export function withSpeechSettings(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Speech settings anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
