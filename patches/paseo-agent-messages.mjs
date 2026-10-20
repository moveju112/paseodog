// 송신자 transport 확장은 기존 steering 패치와 같은 원본 검증 경계를 공유한다.
export const agentMessageTransportEdits = [
    [
        '            input: mapPromptInput(prompt, this.bridge.commands),',
        '            input: options.paseodogSource ? { type: "message", content: mapPromptContent(prompt) } : mapPromptInput(prompt, this.bridge.commands),\n            ...(options.paseodogSource ? { source: options.paseodogSource } : {}),',
    ],
    [
        '            input: { type: "message", content: mapPromptContent(prompt) },',
        '            input: { type: "message", content: mapPromptContent(prompt) },\n            ...(options.paseodogSource ? { source: options.paseodogSource } : {}),',
    ],
];
