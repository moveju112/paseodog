// 고정 웹 번들에서 받아쓰기·음성 모드 진입점(입력창 마이크 버튼과 단축키)만 뺀다. 앱 소스와 같은 동작을 유지한다.
const binding = (id, combo, repeat, mac, kind, label) => `{id:"${id}",action:"message-input.action",combo:"${combo}",`
    + `${repeat ? 'repeat:!1,' : ''}when:{mac:${mac ? '!0' : '!1'},commandCenter:!1,terminal:!1},`
    + `payload:{type:"message-input",kind:"${kind}"},help:{id:"${kind}",section:"agent-input",label:"${label}"}},`;
const toggleBindings = [
    binding('message-input-voice-toggle-cmd-shift-d-mac', 'Cmd+Shift+D', true, true, 'voice-toggle', 'Toggle voice mode'),
    binding('message-input-voice-toggle-ctrl-shift-d-non-mac', 'Ctrl+Shift+D', true, false, 'voice-toggle', 'Toggle voice mode'),
    binding('message-input-dictation-toggle-cmd-d-mac', 'Cmd+D', false, true, 'dictation-toggle', 'Start/stop dictation'),
    binding('message-input-dictation-toggle-ctrl-d-non-mac', 'Ctrl+D', false, false, 'dictation-toggle', 'Start/stop dictation'),
].join('');
const muteBinding = ',{id:"message-input-voice-mute-toggle",action:"message-input.action",combo:"Space",repeat:!1,'
    + 'when:{commandCenter:!1,focusScope:"other"},payload:{type:"message-input",kind:"voice-mute-toggle"},'
    + 'help:{id:"voice-mute-toggle",section:"agent-input",label:"Mute/unmute voice mode"}}';

export const SPEECH_REMOVAL_EDITS = [
    ['chat:{showAttachments:!0,showVoice:!0,', 'chat:{showAttachments:!0,showVoice:!1,'],
    ['label:"Cycle agent mode"}},' + toggleBindings + '{id:"agent-interrupt",', 'label:"Cycle agent mode"}},{id:"agent-interrupt",'],
    ['kind:"dictation-confirm"}}' + muteBinding + ']', 'kind:"dictation-confirm"}}]'],
    ['"agent-input":["focus-message-input","cycle-agent-mode","voice-toggle","dictation-toggle","agent-interrupt","voice-mute-toggle"]',
        '"agent-input":["focus-message-input","cycle-agent-mode","agent-interrupt"]'],
];

export function withSpeechRemoval(source) {
    for (const [before, after] of SPEECH_REMOVAL_EDITS) {
        if (source.split(before).length !== 2) throw new Error('Paseo speech removal anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}

export function withoutSpeechRemoval(source) {
    const original = SPEECH_REMOVAL_EDITS.map(([before]) => source.includes(before));
    if (original.every(Boolean)) return source;
    if (original.some(Boolean)) throw new Error('Partial Paseo speech removal patch');
    for (const [before, after] of [...SPEECH_REMOVAL_EDITS].reverse()) {
        if (source.split(after).length !== 2) throw new Error('Partial Paseo speech removal patch');
        source = source.replace(after, () => before);
    }
    return source;
}
