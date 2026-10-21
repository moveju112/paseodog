// 로컬 패치: 검토된 사이드바 도움말 메뉴에서 문제 신고 묶음(구분선·제목·외부 링크 두 개)만 렌더 목록에서 뺀다.
// 단축키·새 소식·진단 항목과 하단 버전 구분선·목록(fe, ve)은 그대로 둔다.
export const HELP_MENU_ANCHOR = 'testID:"sidebar-help-menu",children:[de,ae,pe,he,ge,Ie,me,Se,fe,ve]';
export const HELP_MENU = 'testID:"sidebar-help-menu",children:[de,ae,pe,he,fe,ve]';

// 패치된 도움말 목록을 원본으로 되돌려 원본 해시 검증을 유지한다.
export function withoutHelpMenu(source) {
    return source.replace(HELP_MENU, () => HELP_MENU_ANCHOR);
}

// 전체 원본 해시를 통과한 번들의 정확한 앵커 하나에만 축소된 도움말 목록을 넣는다.
export function withHelpMenu(source) {
    if (source.split(HELP_MENU_ANCHOR).length !== 2) throw new Error('Paseo help menu anchor mismatch');
    return source.replace(HELP_MENU_ANCHOR, () => HELP_MENU);
}
