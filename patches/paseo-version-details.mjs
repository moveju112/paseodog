import { createVersionLabels } from '../android/packages/app/src/utils/version-labels.ts';
import release from '../plugin/shared/release.json' with { type: 'json' };

const start = '/* paseodog-version-details:start */';
const end = '/* paseodog-version-details:end */';
const anchor = 'function Fe(e){const n=(0,l.c)(34),{appVersion:o,appVersionText:c,isDesktopApp:u}=e,';
const edits = [
    [anchor, 'function Fe(e){const n=(0,l.c)(34),{appVersion:o,appVersionText:paseodogBaseVersion,isDesktopApp:u}=e,c=paseodogVersionLabels.useAppVersionText(paseodogBaseVersion),'],
    ['const k=v&&ot.aboutVersionMismatch;', 'w=paseodogVersionLabels.useHostVersionText(o.serverId,w);const k=v&&ot.aboutVersionMismatch;'],
    ['style:ae.settingsStyles.row,children:[j,v]', 'style:[ae.settingsStyles.row,{flexDirection:"column",alignItems:"stretch",gap:8}],children:[j,v]'],
    ['style:j,children:[P,_]', 'style:[j,{flexDirection:"column",alignItems:"stretch",gap:8}],children:[P,_]'],
    ['style:ot.aboutValue,children:c', 'selectable:!0,style:ot.aboutValue,children:c'],
    ['style:T,children:w', 'selectable:!0,style:T,children:w'],
];

export function withVersionDetails(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2 || source.includes(after))
            throw new Error('Paseo version details anchor mismatch');
        source = source.replace(before, after);
    }
    // 모듈 ID는 고정 원본의 blob 검증으로 보호한다. 제품 버전은 패치 시점에 내장한다.
    const insert = `${start}const paseodogVersionLabels=(${createVersionLabels.toString()})({React:r(36),readAppRelease:async()=>{if(r(883).isElectronRuntime()){const{appVersion}=await r(4381).getDesktopRuntimeInfo();const match=appVersion&&/^(.+)\\.([1-9]\\d*)$/.exec(appVersion);return{version:appVersion,versionCode:match?Number(match[2]):null}}return ${JSON.stringify(release)}},useClient:r(855).useHostRuntimeClient,useConnected:r(855).useHostRuntimeIsConnected,useProvidersSnapshot:r(4061).useProvidersSnapshot});${end}`;
    return source.replace(edits[0][1], () => insert + edits[0][1]);
}

export function withoutVersionDetails(source) {
    const first = source.indexOf(start), last = source.indexOf(end);
    const counts = edits.map(([, after]) => source.split(after).length - 1);
    if (counts.some(count => count > 1) || (counts.includes(1) && counts.includes(0)) ||
        (counts.includes(1) && first < 0) || (first >= 0 && counts.includes(0)))
        throw new Error('Partial Paseo version details patch');
    if (first >= 0 || last >= 0) {
        if (first < 0 || last < first || source.indexOf(start, first + start.length) >= 0 ||
            source.indexOf(end, last + end.length) >= 0)
            throw new Error('Partial Paseo version details patch');
        source = source.slice(0, first) + source.slice(last + end.length);
    }
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, before);
    return source;
}
