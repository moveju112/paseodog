import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const pinSource = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/usage/pin-compatibility.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
const restorePins = new Function(`${pinSource}\nreturn restoreClaudeUsagePins;`)().toString();

export const CHAT_USABILITY_EDITS = [
    ['contentWrapper:{width:"100%",maxWidth:e.contentMaxWidth,alignSelf:"center",paddingHorizontal:e.spacing[2],uni__dependencies:[0]}',
        'contentWrapper:{width:"100%",maxWidth:e.contentMaxWidth,alignSelf:"center",paddingHorizontal:{xs:e.spacing[1],md:e.spacing[2]},uni__dependencies:[0]}'],
    ['streamItemWrapper:{width:"100%",maxWidth:e.contentMaxWidth,alignSelf:"center",paddingHorizontal:e.spacing[2],uni__dependencies:[0]}',
        'streamItemWrapper:{width:"100%",maxWidth:e.contentMaxWidth,alignSelf:"center",paddingHorizontal:{xs:e.spacing[1],md:e.spacing[2]},uni__dependencies:[0]}'],
    ['listContentContainer:{paddingVertical:0,flexGrow:1,paddingHorizontal:{xs:e.spacing[3],md:e.spacing[4]},uni__dependencies:[0]}',
        'listContentContainer:{paddingVertical:0,flexGrow:1,paddingHorizontal:{xs:e.spacing[1],md:e.spacing[4]},uni__dependencies:[0]}'],
    ['e.AttachmentThumbnail=function(o){const n=(0,s.c)(5),{metadata:c}=o,b=(0,y.useAttachmentPreviewUrl)(c),u=b??"";let h;n[0]!==u?(h={uri:u},n[0]=u,n[1]=h):h=n[1];const f=h;if(!b){let o;return n[2]===Symbol.for("react.memo_cache_sentinel")?(o=(0,_.jsx)(t.View,{style:S.thumbnailPlaceholder}),n[2]=o):o=n[2],o}let p;n[3]!==f?(p=(0,_.jsx)(l.Image,{source:f,style:S.thumbnail}),n[3]=f,n[4]=p):p=n[4];return p}',
        'e.AttachmentThumbnail=function({metadata:o,sent:n=!1}){const c=(0,y.useAttachmentPreviewUrl)(o),b=n?{width:96,height:96}:null;return c?(0,_.jsx)(l.Image,{source:{uri:c},style:[S.thumbnail,b]}):(0,_.jsx)(t.View,{style:[S.thumbnailPlaceholder,b]})}'],
    ['(0,ce.jsx)(ee.AttachmentThumbnail,{metadata:n})',
        '(0,ce.jsx)(ee.AttachmentThumbnail,{metadata:n,sent:!0})'],
    ['function l(n,t){if(null!==n.pins)return n.pins;',
        `function l(n,t){if(null!==n.pins)return (${restorePins})(n.pins,t);`],
];

// 전체 번들 해시 확인 전에 이번 UI 편집만 역순으로 제거한다.
export function withoutChatUsability(source) {
    const counts = CHAT_USABILITY_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Paseo chat usability patch drift');
    if (counts.includes(0) && counts.some((count) => count > 0)) throw new Error('Partial Paseo chat usability patch');
    for (const [before, after] of [...CHAT_USABILITY_EDITS].reverse()) source = source.replace(after, () => before);
    return source;
}

// 검토된 원본의 단일 앵커에만 전송 이미지 확대·Claude 고정 항목 호환을 적용한다.
export function withChatUsability(source) {
    for (const [before, after] of CHAT_USABILITY_EDITS) {
        if (source.split(before).length !== 2) throw new Error('Paseo chat usability anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
