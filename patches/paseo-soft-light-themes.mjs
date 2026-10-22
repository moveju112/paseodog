import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const paletteSource = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/styles/soft-light-palettes.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
const palettes = new Function(`${paletteSource}\nreturn softLightPalettes;`)();

// 번들의 원문 이스케이프를 유지해 언어별 테마 옵션을 같은 위치에 추가한다.
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

export const SOFT_LIGHT_OPTIONS = Object.entries(palettes).map(([name, palette]) => {
    const unistylesName = name === 'neutralPearl' ? 'lightNeutralPearl' : 'lightSoftLinen';
    return `{name:"${name}",group:"variant",unistylesName:"${unistylesName}",theme:q({...O(${JSON.stringify(palette.config)}),...${JSON.stringify(palette.overrides)}}),swatch:"${palette.config.surface0}"}`;
});
const optionAnchor = 'swatch:"#ffffff"}],ee="plugin"';
export const SOFT_LIGHT_EDITS = [
    [optionAnchor, `swatch:"#ffffff"},${SOFT_LIGHT_OPTIONS.join(',')}],ee="plugin"`],
    ...WHITE2_LABELS.map(([pureBlack, white2]) => {
        const pearl = white2 === 'White2' ? 'Neutral Pearl' : String.raw`\ub274\ud2b8\ub7f4 \ud384`;
        const linen = white2 === 'White2' ? 'Soft Linen' : String.raw`\uc18c\ud504\ud2b8 \ub9b0\ub128`;
        return [`pureBlack:"${pureBlack}",white2:"${white2}",auto:"`,
            `pureBlack:"${pureBlack}",white2:"${white2}",neutralPearl:"${pearl}",softLinen:"${linen}",auto:"`];
    }),
];
export const SOFT_LIGHT_SURFACE_EDITS = [
    ['bubble:{backgroundColor:"light"===e.colorScheme?"#eaf0eb":e.colors.surface3,',
        'bubble:{backgroundColor:e.colors.userMessageBackground??("light"===e.colorScheme?"#eaf0eb":e.colors.surface3),'],
    ['backgroundColor:"light"===e.colorScheme?"#ffffff":e.colors.surface1,borderWidth:e.borderWidth[1],borderColor:"light"===e.colorScheme?"#dce3dd":e.colors.borderAccent,',
        'backgroundColor:e.colors.composerBackground??("light"===e.colorScheme?"#ffffff":e.colors.surface1),borderWidth:e.borderWidth[1],borderColor:e.colors.composerBorder??("light"===e.colorScheme?"#dce3dd":e.colors.borderAccent),'],
    ['container:{flex:1,backgroundColor:"light"===e.colorScheme?"#fafbf9":e.colors.surface0,uni__dependencies:[0]},contentWrapper:{',
        'container:{flex:1,backgroundColor:e.colors.conversationBackground??("light"===e.colorScheme?"#fafbf9":e.colors.surface0),uni__dependencies:[0]},contentWrapper:{'],
];

// 두 테마와 표시 토큰을 함께 되돌리고 부분 적용·중복 패치는 거절한다.
export function withoutSoftLightThemes(source, edits = SOFT_LIGHT_EDITS) {
    const counts = edits.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Paseo soft light theme patch drift');
    if (counts.includes(0) && counts.some((count) => count > 0)) throw new Error('Partial Paseo soft light theme patch');
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}

// 해시 검증 후 White2가 등록된 원본에만 두 팔레트와 선택 항목을 추가한다.
export function withSoftLightThemes(source, edits = SOFT_LIGHT_EDITS) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo soft light theme anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
