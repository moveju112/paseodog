// 로컬 선택 확장: 원래 assistant_message에 선택적인 공급자 단계를 보존한다.
export const PROVIDER_PHASE_EDITS = [[
    '        type: z.literal("assistant_message"),\n        text: z.string(),\n        messageId: z.string().optional(),',
    '        type: z.literal("assistant_message"),\n        text: z.string(),\n        messageId: z.string().optional(),\n        phase: z.enum(["commentary", "final_answer"]).optional(),',
]];
export const MESSAGES_PHASE_EDITS = PROVIDER_PHASE_EDITS;
export const ADAPTER_PHASE_EDITS = [[
    '        if (text.length === 0)\n            return null;\n        return item.type === "assistant_message"\n            ? { type: "assistant_message", text, messageId: item.messageId ?? id }',
    '        const phaseChanged = item.type === "assistant_message" && item.phase !== undefined &&\n            (previous?.type !== "assistant_message" || previous.phase !== item.phase);\n        if (text.length === 0 && !phaseChanged)\n            return null;\n        return item.type === "assistant_message"\n            ? { type: "assistant_message", text, messageId: item.messageId ?? id, ...(item.phase ? { phase: item.phase } : {}) }',
]];
export const PROJECTION_PHASE_EDITS = [[
    '                ...(previousAssistant.messageId ? { messageId: previousAssistant.messageId } : {}),',
    '                ...(previousAssistant.messageId ? { messageId: previousAssistant.messageId } : {}),\n                ...((entryAssistant.phase ?? previousAssistant.phase) ? { phase: entryAssistant.phase ?? previousAssistant.phase } : {}),',
]];

// 최초 단계 확장본의 빈 텍스트 판정을 현재 판정으로만 정규화한다.
export function normalizeAssistantPhase(source) {
    return source.replace(
        '        const phaseChanged = item.type === "assistant_message" &&\n            (previous?.type !== "assistant_message" || previous.phase !== item.phase);',
        '        const phaseChanged = item.type === "assistant_message" && item.phase !== undefined &&\n            (previous?.type !== "assistant_message" || previous.phase !== item.phase);');
}

// 이전 독립 패치가 같은 파일을 재검사할 때 원래 바이트를 복원한다.
export function withoutAssistantPhase(source, edits) {
    return [...edits].reverse().reduce((result, [before, after]) => result.replace(after, before), normalizeAssistantPhase(source));
}

// 검토한 원본 앵커에만 선택 필드를 넣는다.
export function withAssistantPhase(source, edits) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2 || source.includes(after)) throw new Error('Paseo assistant phase anchor mismatch');
        source = source.replace(before, after);
    }
    return source;
}
