// 로컬 패치: 새 작업공간의 가져오기에 선택한 프로젝트 경로를 전달한다.
export const IMPORT_CWD_ANCHOR = '(0,fe.useImportSession)({serverId:T})';
export const IMPORT_CWD = '(0,fe.useImportSession)({serverId:T,cwd:Wt??void 0})';
export const SOURCE_IMPORT_CWD_ANCHOR = 'useImportSession({ serverId: selectedServerId })';
export const SOURCE_IMPORT_CWD = 'useImportSession({ serverId: selectedServerId, cwd: selectedSourceDirectory ?? undefined })';

// 추가한 경로만 되돌려 기존 전체 번들 원본 해시 검사를 유지한다.
export function withoutImportCwd(source) {
    return source.replace(IMPORT_CWD, () => IMPORT_CWD_ANCHOR);
}

// 검토된 공유 화면의 호출 하나만 바꾸고 프로젝트 없는 가져오기는 유지한다.
export function withImportCwd(source) {
    if (source.split(IMPORT_CWD_ANCHOR).length !== 2) throw new Error('Paseo import cwd anchor mismatch');
    return source.replace(IMPORT_CWD_ANCHOR, () => IMPORT_CWD);
}
