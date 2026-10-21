// 로컬 패치: 검토된 웹 번들에서 외부 커뮤니티·저장소 링크 버튼(Star·Sponsor·Community, 시작 화면 링크, 오류 화면 이슈·문서, 변경 내역 외부 링크)만 렌더하지 않는다.
const COPY_LOGS = 'onPress:z,children:"Copy logs"}),';
const RETRY = '(0,F.jsx)(j.Button,{variant:"default",leftIcon:R,onPress:e.retry,children:"Retry"})';
export const EXTERNAL_LINK_EDITS = [
    ['(ge=(0,R.jsx)(s.View,{style:O.communityRow,children:(0,R.jsx)(j.CommunityLinks,{})}),t[51]=ge)', '(ge=null,t[51]=ge)'],
    ['(V=(0,Pe.jsx)(t.View,{style:ot.aboutCommunity,children:(0,Pe.jsx)(J.CommunityLinks,{})}),n[30]=V)', '(V=null,n[30]=V)'],
    [COPY_LOGS + '(0,F.jsx)(j.Button,{variant:"outline",leftIcon:E,onPress:D,children:"Open GitHub issue"}),(0,F.jsx)(j.Button,{variant:"outline",leftIcon:I,onPress:P,children:"Docs"}),' + RETRY,
        COPY_LOGS + RETRY],
    ['(B={title:b,leading:V,actions:C},n[7]=b', '(B={title:b,leading:V},n[7]=b'],
    ['(Be=D.isNative?(0,z.jsxs)(s.Pressable,{style:B.setupLink,onPress:se,children:[(0,z.jsx)(o.Text,{style:B.setupLinkText,children:"PaseoDog \\xb7 GitHub"}),(0,z.jsx)(b.ExternalLink,{size:14,color:H.colors.accent})]}):null,W[36]',
        '(Be=null,W[36]'],
];

// 패치된 렌더 값을 원본으로 되돌려 원본 해시 검증을 유지한다.
export function withoutExternalLinks(source) {
    return [...EXTERNAL_LINK_EDITS].reverse().reduce((text, [before, after]) => text.replace(after, () => before), source);
}

// 전체 원본 해시를 통과한 번들의 정확한 앵커 하나씩에만 링크 제거를 넣는다.
export function withExternalLinks(source) {
    return EXTERNAL_LINK_EDITS.reduce((text, [before, after]) => {
        if (text.split(before).length !== 2) throw new Error('Paseo external links anchor mismatch');
        return text.replace(before, () => after);
    }, source);
}
