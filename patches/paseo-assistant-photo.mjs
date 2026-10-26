import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { ASSISTANT_ICONS } from '../android/packages/app/src/hooks/use-settings/assistant-icons.ts';
import { normalizeAssistantPhoto } from '../android/packages/app/src/hooks/use-settings/assistant-photo.ts';

const sharedSource = (path) => stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/' + path, import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const photoSource = sharedSource('hooks/use-settings/assistant-photo.ts');
const pickerSource = sharedSource('hooks/assistant-photo-picker.ts');
const profileSource = sharedSource('screens/settings/chat/assistant-profile-settings.ts');
const bootstrap = `const pdAssistantProfile=(()=>{${photoSource}\n${pickerSource}\n${profileSource}\nreturn createAssistantProfileSettings({React:r(d[2]),View:t.View,Image:r(393).Image,SettingsSelect:s.SettingsSelect,SettingsAction:s.SettingsAction,SettingsRow:s.SettingsRow,useTranslation:n.useTranslation,useAppSettings:c.useAppSettings,icons:${JSON.stringify(ASSISTANT_ICONS)},pickPhoto:pickAssistantPhoto})})();`;

export function assistantPhotoEdits(picker) {
    const schema = `assistantIcon:f.z.enum(${JSON.stringify(ASSISTANT_ICONS)}).catch(""),`;
    return [
        ['assistantIcon:"",toolCallDetailLevel:', 'assistantIcon:"",assistantPhoto:"",toolCallDetailLevel:'],
        [schema, `${schema}assistantPhoto:f.z.string().transform(${normalizeAssistantPhoto.toString()}).catch(""),`],
        ['u=r(d[8]);const p=["detailed","overview"]', `u=r(d[8]);${bootstrap}const p=["detailed","overview"]`],
        [picker, '(0,u.jsx)(pdAssistantProfile,{testID:"assistant-profile-settings"})'],
    ];
}

export function withAssistantPhoto(source, picker) {
    for (const [before, after] of assistantPhotoEdits(picker)) {
        if (source.split(before).length !== 2) throw new Error('Paseo assistant photo anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}

export function withoutAssistantPhoto(source, picker) {
    const edits = assistantPhotoEdits(picker);
    const counts = edits.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1) || (counts.some(Boolean) && counts.includes(0)))
        throw new Error('Partial Paseo assistant photo patch');
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}
