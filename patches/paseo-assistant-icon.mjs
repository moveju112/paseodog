import { ASSISTANT_ICONS } from '../android/packages/app/src/hooks/use-settings/assistant-icons.ts';
import { withAssistantPhoto, withoutAssistantPhoto } from './paseo-assistant-photo.mjs';

const options = '[{value:"",label:v("settings.general.assistantIcon.initial")},'
    + ASSISTANT_ICONS.filter(Boolean).map((value) => JSON.stringify({ value, label: value })).join(',') + ']';
const picker = `(0,u.jsx)(s.SettingsSelect,{label:v("settings.general.assistantIcon.label"),hint:v("settings.general.assistantIcon.description"),value:x.assistantIcon,options:${options},onValueChange:t=>C({assistantIcon:t}),testID:"assistant-icon-select"})`;
const translations = [
    ['assistantNickname:{"label":"اسم المساعد","description":"الاسم المعروض في المحادثات. اتركه فارغًا لاستخدام Dog."}',
        { label: 'أيقونة المساعد', description: 'الأيقونة بجانب الاسم في المحادثات. تُحفظ على هذا الجهاز.', initial: 'الحرف الأول من الاسم (افتراضي)' }],
    ['assistantNickname:{"label":"Assistant nickname","description":"Name shown in conversations. Leave empty to use Dog."}',
        { label: 'Assistant icon', description: 'Icon shown beside the nickname in conversations. Saved on this device.', initial: 'Nickname initial (default)' }],
    ['assistantNickname:{"label":"도우미 닉네임","description":"대화에 표시할 이름입니다. 비워 두면 Dog를 사용합니다."}',
        { label: '도우미 아이콘', description: '대화의 닉네임 옆에 표시할 아이콘입니다. 이 기기에 저장됩니다.', initial: '닉네임 첫 글자 (기본)' }],
    ['assistantNickname:{"label":"Apodo del asistente","description":"Nombre mostrado en las conversaciones. Déjalo vacío para usar Dog."}',
        { label: 'Icono del asistente', description: 'Icono junto al apodo en las conversaciones. Se guarda en este dispositivo.', initial: 'Inicial del apodo (predeterminado)' }],
    ['assistantNickname:{"label":"Surnom de l’assistant","description":"Nom affiché dans les conversations. Laissez vide pour utiliser Dog."}',
        { label: 'Icône de l’assistant', description: 'Icône à côté du surnom dans les conversations. Enregistrée sur cet appareil.', initial: 'Initiale du surnom (par défaut)' }],
    ['assistantNickname:{"label":"アシスタントのニックネーム","description":"会話に表示する名前です。空欄の場合は Dog を使います。"}',
        { label: 'アシスタントのアイコン', description: '会話でニックネームの横に表示するアイコンです。この端末に保存されます。', initial: 'ニックネームの頭文字（デフォルト）' }],
    ['assistantNickname:{"label":"Apelido do assistente","description":"Nome exibido nas conversas. Deixe vazio para usar Dog."}',
        { label: 'Ícone do assistente', description: 'Ícone ao lado do apelido nas conversas. Salvo neste dispositivo.', initial: 'Inicial do apelido (padrão)' }],
    ['assistantNickname:{"label":"Имя помощника","description":"Имя в диалогах. Оставьте пустым, чтобы использовать Dog."}',
        { label: 'Значок помощника', description: 'Значок рядом с именем в диалогах. Сохраняется на этом устройстве.', initial: 'Первая буква имени (по умолчанию)' }],
    ['assistantNickname:{"label":"助手昵称","description":"对话中显示的名称。留空则使用 Dog。"}',
        { label: '助手图标', description: '对话中昵称旁显示的图标。保存在此设备上。', initial: '昵称首字（默认）' }],
];
export const ASSISTANT_ICON_EDITS = [
    ['assistantNickname:"Dog",toolCallDetailLevel:', 'assistantNickname:"Dog",assistantIcon:"",toolCallDetailLevel:'],
    ['assistantNickname:f.z.string().trim().min(1).catch("Dog"),',
        `assistantNickname:f.z.string().trim().min(1).catch("Dog"),assistantIcon:f.z.enum(${JSON.stringify(ASSISTANT_ICONS)}).catch(""),`],
    ['testID:"assistant-nickname-input"}),f,', `testID:"assistant-nickname-input"}),${picker},f,`],
    ...translations.map(([before, copy]) => [before, before + ',assistantIcon:' + JSON.stringify(copy)]),
];

// 닉네임 패치 내부에서 적용·해제하므로 기존 전체 번들 hash gate와 역순 해제를 유지한다.
export function withAssistantIcon(source) {
    for (const [before, after] of ASSISTANT_ICON_EDITS) {
        if (source.split(before).length !== 2) throw new Error('Paseo assistant icon anchor mismatch');
        source = source.replace(before, () => after);
    }
    return withAssistantPhoto(source, picker);
}

export function withoutAssistantIcon(source) {
    source = withoutAssistantPhoto(source, picker);
    const counts = ASSISTANT_ICON_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1) || (counts.some(Boolean) && counts.includes(0)))
        throw new Error('Partial Paseo assistant icon patch');
    for (const [before, after] of [...ASSISTANT_ICON_EDITS].reverse()) source = source.replace(after, () => before);
    return source;
}
