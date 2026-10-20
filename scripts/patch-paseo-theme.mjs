// 화이트2는 원본 라이트 배경을 유지하고 보조 글자·아이콘·입력창 경계만 선명하게 한다.
// 기존 light 항목·팔레트는 건드리지 않고, 설정 스키마·Unistyles 등록·스와치는 THEME_OPTIONS에서 파생된다.
export const WHITE2_OPTION = '{name:"white2",group:"variant",unistylesName:"lightWhite2",theme:q({...E,foregroundMuted:"#52525b",foregroundExtraMuted:"#71717a",mutedForeground:"#52525b",border:"#d4d4d8",borderAccent:"#c4c4cc",accentBorder:"#c4c4cc",composerPlaceholder:"#71717a",composerFocusHintOpacity:1}),swatch:"#ffffff"}';
const legacyOption = '{name:"white2",group:"variant",unistylesName:"lightWhite2",theme:q(E),swatch:"#ffffff"}';
// 번들의 각 언어 pureBlack 라벨(원문 이스케이프 그대로)과 그 뒤에 붙일 화이트2 라벨.
export const WHITE2_LABELS = [
    [String.raw`\u0623\u0633\u0648\u062f \u062e\u0627\u0644\u0635`, 'White2'],
    ['Pure black', 'White2'],
    ['Negro puro', 'White2'],
    ['Noir pur', 'White2'],
    [String.raw`\u30d4\u30e5\u30a2\u30d6\u30e9\u30c3\u30af`, 'White2'],
    [String.raw`\uc21c\uc218 \uac80\uc815`, String.raw`\ud654\uc774\ud2b82`],
    ['Preto puro', 'White2'],
    [String.raw`\u0410\u0431\u0441\u043e\u043b\u044e\u0442\u043d\u043e \u0447\u0451\u0440\u043d\u0430\u044f`, 'White2'],
    [String.raw`\u7eaf\u9ed1`, 'White2'],
];
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
    return result;
}
