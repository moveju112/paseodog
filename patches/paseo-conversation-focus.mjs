import { HIDE_REASONING_EDITS } from './paseo-hide-reasoning.mjs';
import { SOFT_LIGHT_SURFACE_EDITS, withSoftLightThemes, withoutSoftLightThemes } from './paseo-soft-light-themes.mjs';
import { withAssistantIcon, withoutAssistantIcon } from './paseo-assistant-icon.mjs';

const nicknameInput = '(0,u.jsx)(s.SettingsInput,{label:v("settings.general.assistantNickname.label"),hint:v("settings.general.assistantNickname.description"),initialValue:x.assistantNickname,placeholder:"Dog",onChangeText:t=>C({assistantNickname:t}),testID:"assistant-nickname-input"})';
const nicknameResources = HIDE_REASONING_EDITS.filter(([before]) => before.startsWith('autoExpandReasoning:{'));
const nicknameCopies = [
    ['اسم المساعد', 'الاسم المعروض في المحادثات. اتركه فارغًا لاستخدام Dog.'],
    ['Assistant nickname', 'Name shown in conversations. Leave empty to use Dog.'],
    ['Apodo del asistente', 'Nombre mostrado en las conversaciones. Déjalo vacío para usar Dog.'],
    ['Surnom de l’assistant', 'Nom affiché dans les conversations. Laissez vide pour utiliser Dog.'],
    ['アシスタントのニックネーム', '会話に表示する名前です。空欄の場合は Dog を使います。'],
    ['도우미 닉네임', '대화에 표시할 이름입니다. 비워 두면 Dog를 사용합니다.'],
    ['Apelido do assistente', 'Nome exibido nas conversas. Deixe vazio para usar Dog.'],
    ['Имя помощника', 'Имя в диалогах. Оставьте пустым, чтобы использовать Dog.'],
    ['助手昵称', '对话中显示的名称。留空则使用 Dog。'],
];

export const CONVERSATION_FOCUS_EDITS = [
    ['hideReasoning:!1,toolCallDetailLevel:', 'hideReasoning:!1,assistantNickname:"Dog",toolCallDetailLevel:'],
    ['hideReasoning:f.z.boolean().catch(!1),', 'hideReasoning:f.z.boolean().catch(!1),assistantNickname:f.z.string().trim().min(1).catch("Dog"),'],
    ['!0?(P=(0,u.jsxs)(s.SettingsCard,{children:[f,', `!0?(P=(0,u.jsxs)(s.SettingsCard,{children:[${nicknameInput},f,`],
    ['bubble:{backgroundColor:e.colors.surface3,borderRadius:e.borderRadius["2xl"],borderTopRightRadius:e.borderRadius.sm,paddingHorizontal:e.spacing[4],paddingVertical:e.spacing[4],minWidth:0,flexShrink:1,uni__dependencies:[0]}',
        'bubble:{backgroundColor:"light"===e.colorScheme?"#eaf0eb":e.colors.surface3,borderRadius:16,borderBottomRightRadius:4,paddingHorizontal:e.spacing[4],paddingVertical:e.spacing[3],minWidth:0,flexShrink:1,uni__dependencies:[0]}'],
    ['lineHeight:Math.round(1.4*e.fontSize.content),overflowWrap:"anywhere"', 'lineHeight:Math.round(1.8*e.fontSize.content),overflowWrap:"anywhere"'],
    ['inputWrapper:Object.assign({flexShrink:1,flexDirection:"column",gap:e.spacing[3],backgroundColor:e.colors.surface1,borderWidth:e.borderWidth[1],borderColor:e.colors.borderAccent,borderRadius:e.borderRadius["2xl"],',
        'inputWrapper:Object.assign({flexShrink:1,flexDirection:"column",gap:e.spacing[3],backgroundColor:"light"===e.colorScheme?"#ffffff":e.colors.surface1,borderWidth:e.borderWidth[1],borderColor:"light"===e.colorScheme?"#dce3dd":e.colors.borderAccent,borderRadius:16,'],
    ['container:{flex:1,backgroundColor:e.colors.surface0,uni__dependencies:[0]},contentWrapper:{',
        'container:{flex:1,backgroundColor:"light"===e.colorScheme?"#fafbf9":e.colors.surface0,uni__dependencies:[0]},contentWrapper:{'],
    ...nicknameResources.map(([, after], index) => [after, after + ',assistantNickname:' + JSON.stringify({
        label: nicknameCopies[index][0],
        description: nicknameCopies[index][1],
    })]),
];

// 검토한 composer 원본에만 닉네임 설정과 대화 집중형 표시를 적용한다.
export function withConversationFocus(source) {
    for (const [before, after] of CONVERSATION_FOCUS_EDITS) {
        if (source.split(before).length !== 2 || source.includes(after))
            throw new Error('Paseo conversation focus anchor mismatch');
        source = source.replace(before, () => after);
    }
    return withAssistantIcon(withSoftLightThemes(source, SOFT_LIGHT_SURFACE_EDITS));
}

// 전체 적용본만 되돌려 기존 버전·blob 검증을 유지하고 일부 적용은 거부한다.
export function withoutConversationFocus(source) {
    source = withoutAssistantIcon(source);
    source = withoutSoftLightThemes(source, SOFT_LIGHT_SURFACE_EDITS);
    const counts = CONVERSATION_FOCUS_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1) || (counts.some(Boolean) && counts.includes(0)))
        throw new Error('Partial Paseo conversation focus patch');
    return [...CONVERSATION_FOCUS_EDITS].reverse().reduce((result, [before, after]) => result.replace(after, () => before), source);
}
