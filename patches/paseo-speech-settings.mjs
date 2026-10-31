import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

const source = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/screens/settings/speech-settings.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const component = `const PaseodogSpeechSettings=(()=>{const {createElement,useCallback,useEffect,useRef,useState}=u,{View}=n,{Text}=o,{Pressable}=r,{settingsStyles}=S,{SelectField}=_r(4659),{useHostRuntimeClient,useHostRuntimeIsConnected}=_r(3762);${source};return SpeechSettings})();`;
const previousComponents = new Set([
    'a047a6384588c337a2d01416fe7b61174b888822b19a587c69bb3cba069416b5',
    'e5023d4423d17b844bd29e740c32acb7041008d17fccb40ccb72e1b0687bd2f2',
]);
const edits = [
    ['const PaseodogAgentMessageSettings=', component + 'const PaseodogAgentMessageSettings='],
    ['u.createElement(PaseodogBaseAiEnginePage,e),',
        'u.createElement(PaseodogBaseAiEnginePage,e),e.section==="workflow"?u.createElement(PaseodogSpeechSettings,{key:"speech:"+e.serverId,serverId:e.serverId}):null,'],
];

export function withoutSpeechSettings(source) {
    const matches = [...source.matchAll(/const PaseodogSpeechSettings=\(\(\)=>\{[\s\S]*?;return SpeechSettings\}\)\(\);/g)];
    if (matches.length > 1) throw new Error('Speech settings patch drift');
    if (matches.length) {
        const actual = matches[0][0];
        if (actual !== component && !previousComponents.has(createHash('sha256').update(actual).digest('hex')))
            throw new Error('Speech settings source hash mismatch');
        source = source.replace(actual, () => component);
    }
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
