// 화이트2는 원본 라이트 배경을 유지하고 보조 글자·아이콘·입력창 경계만 선명하게 한다.
// 기존 light 항목·팔레트는 건드리지 않고, 설정 스키마·Unistyles 등록·스와치는 THEME_OPTIONS에서 파생된다.
import { WHITE2_LABELS, withSoftLightThemes, withoutSoftLightThemes } from '../patches/paseo-soft-light-themes.mjs';
export { WHITE2_LABELS };
export const WHITE2_OPTION = '{name:"white2",group:"variant",unistylesName:"lightWhite2",theme:q({...E,foregroundMuted:"#52525b",foregroundExtraMuted:"#71717a",mutedForeground:"#52525b",border:"#d4d4d8",borderAccent:"#c4c4cc",accentBorder:"#c4c4cc",composerPlaceholder:"#71717a",composerFocusHintOpacity:1}),swatch:"#ffffff"}';
const legacyOption = '{name:"white2",group:"variant",unistylesName:"lightWhite2",theme:q(E),swatch:"#ffffff"}';
const optionAnchor = '{name:"pureBlack",group:"variant",unistylesName:"darkPureBlack",theme:K,swatch:"#000000"}],ee="plugin"';
const edits = [
    [optionAnchor, optionAnchor.replace('}],', '},' + WHITE2_OPTION + '],')],
    ...WHITE2_LABELS.map(([pureBlack, white2]) => [`pureBlack:"${pureBlack}",auto:"`,
        `pureBlack:"${pureBlack}",white2:"${white2}",auto:"`]),
    ['placeholderTextColor:e.colors.surface4', 'placeholderTextColor:e.colors.composerPlaceholder??e.colors.surface4'],
    ['focusHintText:{position:"absolute",top:0,right:0,fontSize:e.fontSize.sm,color:e.colors.foregroundMuted,opacity:.5,uni__dependencies:[0]}',
        'focusHintText:{position:"absolute",top:0,right:0,fontSize:e.fontSize.sm,color:e.colors.foregroundMuted,opacity:e.colors.composerFocusHintOpacity??.5,uni__dependencies:[0]}'],
];
const legacyEdits = [
    [optionAnchor, optionAnchor.replace('}],', '},' + legacyOption + '],')],
    ...edits.slice(1, 1 + WHITE2_LABELS.length),
];

// 화이트2 제거 (기존·대비 개선판 전부 적용 -> 원본 복원, 일부만 적용 -> 거부)
export function withoutWhite2Theme(source) {
    source = withoutSoftLightThemes(source);
    const appliedEdits = source.includes(legacyOption) ? legacyEdits : edits;
    const present = appliedEdits.filter(([, after]) => source.includes(after)).length;
    if (present && present !== appliedEdits.length) throw new Error('Partial Paseo White2 theme patch');
    let result = source;
    for (const [before, after] of appliedEdits) result = result.replace(after, before);
    return result;
}

// 화이트2 추가 (검토 원본의 앵커가 정확히 한 번씩 있을 때만)
export function withWhite2Theme(original) {
    let result = original;
    for (const [before, after] of edits) {
        if (result.split(before).length !== 2) throw new Error('Paseo White2 theme anchor mismatch');
        result = result.replace(before, after);
    }
    return withSoftLightThemes(result);
}
