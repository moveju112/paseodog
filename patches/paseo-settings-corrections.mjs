// 고정 번들의 미지원 설정·릴리스 안내는 숨기고 Recap 설명을 실제 메모리 사이클에 맞춘다.
const edits = [
    ['children:[w,I,k,C]', 'children:[w,k,C]'],
    ['children:[Q,be]', 'children:[be]'],
    ['children:[le,ie,ne,ae,ce,ue,me,xe,ge]', 'children:[le,ie,ne,ae,ce,ue,me,ge]'],
    [String.raw`\uc138\uc158 \ubcf5\uadc0 \uc694\uc57d (Recap)`, String.raw`\ubc31\uadf8\ub77c\uc6b4\ub4dc \uba54\ubaa8\ub9ac (Recap)`],
    [String.raw`\uc138\uc158 \uc7ac\uac1c \uc2dc \uc774\uc804 \uc791\uc5c5 \uc694\uc57d\ubcf8\uc744 \uc790\ub3d9\uc73c\ub85c \uc81c\uacf5`,
        String.raw`\ubc31\uadf8\ub77c\uc6b4\ub4dc \uba54\ubaa8\ub9ac \uc815\ub9ac\u00b7\uc694\uc57d \uc0ac\uc774\ud074\uc744 \uc0ac\uc6a9`],
    [String.raw`accessibilityLabel:"\uc138\uc158 \ubcf5\uadc0 \uc694\uc57d"`,
        String.raw`accessibilityLabel:"\ubc31\uadf8\ub77c\uc6b4\ub4dc \uba54\ubaa8\ub9ac"`],
];

// 원본 검증 전에 정확한 설정 변경만 역순으로 해제한다.
export function withoutSettingsCorrections(source) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, before);
    return source;
}

// 원본 해시 검증 후 각 단일 앵커에 설정 의미 수정을 적용한다.
export function withSettingsCorrections(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo settings correction anchor mismatch');
        source = source.replace(before, after);
    }
    return source;
}
