import { createDaemonUpdateCallouts } from '../android/packages/app/src/desktop/updates/daemon-update-callouts.ts';

const anchor = 'e.UpdateCalloutSource=function(){';
const moduleTail = '},4819,[455,1219,36,855,56,4136,4135,4820,4821,4137,4162,279]);';
const start = '/* paseodog-daemon-update:start */';
const end = '/* paseodog-daemon-update:end */';

// 고정 버전·전체 blob 검증은 composer 체인이 담당한다. 의존 모듈도 검토된 export로 찾는다.
function moduleId(source, marker) {
    const position = source.indexOf(marker);
    if (position < 0) throw new Error('Paseo daemon update module anchor mismatch');
    const next = source.indexOf('\n__d(', position);
    const text = source.slice(position, next < 0 ? undefined : next);
    const match = /\},(\d+),\[[\d,]*\]\);\s*$/.exec(text);
    if (!match) throw new Error('Paseo daemon update module boundary mismatch');
    return match[1];
}

export function withDaemonUpdate(source) {
    if (source.split(anchor).length !== 2 || source.split(moduleTail).length !== 2 ||
        source.includes(start) || source.includes(end))
        throw new Error('Paseo daemon update anchor mismatch');
    const runtime = `r(${moduleId(source, 'e.useHosts=')})`;
    const callouts = `r(${moduleId(source, 'e.useSidebarCallouts=')})`;
    const providers = `r(${moduleId(source, 'e.useProvidersSnapshot=')})`;
    // 기존 앱 알림은 그대로 보존하고, 같은 React 모듈로 데몬 알림을 함께 마운트한다.
    const insert = `${start};const PaseodogDaemonUpdates=(${createDaemonUpdateCallouts.toString()})({React:r(36),useHosts:${runtime}.useHosts,useClient:${runtime}.useHostRuntimeClient,useConnected:${runtime}.useHostRuntimeIsConnected,useProvidersSnapshot:${providers}.useProvidersSnapshot,useCallouts:${callouts}.useSidebarCallouts,openURL:e=>globalThis.open(e,"_blank","noopener,noreferrer"),fetch:(...e)=>globalThis.fetch(...e)});const PaseodogOriginalUpdateCallout=e.UpdateCalloutSource;e.UpdateCalloutSource=function(){return r(36).createElement(r(36).Fragment,null,r(36).createElement(PaseodogOriginalUpdateCallout),r(36).createElement(PaseodogDaemonUpdates))};${end}`;
    return source.replace(moduleTail, () => insert + moduleTail);
}

export function withoutDaemonUpdate(source) {
    const first = source.indexOf(start), last = source.indexOf(end);
    if (first < 0 && last < 0) return source;
    if (first < 0 || last < first || source.indexOf(start, first + start.length) >= 0 ||
        source.indexOf(end, last + end.length) >= 0)
        throw new Error('Partial Paseo daemon update patch');
    return source.slice(0, first) + source.slice(last + end.length);
}
