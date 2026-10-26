// 로컬 패치: 새 작업공간의 가져오기에 선택한 프로젝트 경로를 전달한다.
export const IMPORT_CWD_ANCHOR = '(0,fe.useImportSession)({serverId:T})';
export const IMPORT_CWD = '(0,fe.useImportSession)({serverId:T,cwd:Wt??void 0})';
export const SOURCE_IMPORT_CWD_ANCHOR = 'useImportSession({ serverId: selectedServerId })';
export const SOURCE_IMPORT_CWD = 'useImportSession({ serverId: selectedServerId, cwd: selectedSourceDirectory ?? undefined })';

export const IMPORT_LAUNCHER_ANCHOR = '()=>({showChanges:Sa,showPullRequest:Wa,showBrowser:ss,terminalDisabled:ns,launch:Gr}),[ns,Wa,Sa,Gr,ss]';
export const IMPORT_LAUNCHER = '()=>({showChanges:Sa,showPullRequest:Wa,showBrowser:ss,terminalDisabled:ns,importSession:{disabled:!nt,open:st},launch:Gr}),[nt,ns,Wa,Sa,Gr,st,ss]';
export const IMPORT_MENU_ANCHOR = 'h=[];for(const e of j)if(e.serverId===I)';
export const IMPORT_MENU_INSERT = '"menu"===T&&"main"===L&&D.importSession&&p.splice(p.findIndex(e=>"agent"===e.id)+1,0,{id:"import-session",label:S("workspace.header.actions.importSession"),Icon:o.Import,disabled:D.importSession.disabled,panelKind:"draft",launch:D.importSession.open});';
const edits = [
    [IMPORT_CWD_ANCHOR, IMPORT_CWD],
    [IMPORT_LAUNCHER_ANCHOR, IMPORT_LAUNCHER],
    [IMPORT_MENU_ANCHOR, 'h=[];' + IMPORT_MENU_INSERT + 'for(const e of j)if(e.serverId===I)'],
];

// 추가한 경로만 되돌려 기존 전체 번들 원본 해시 검사를 유지한다.
export function withoutImportCwd(source) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}

// 기존 프로젝트 범위·연결 상태·가져오기 창을 + 메뉴에서도 그대로 사용한다.
export function withImportCwd(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo import cwd anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
