import { createAgentMessagePolicy } from '../android/packages/server/src/server/agent/agent-message-policy.ts';

export const agentMessagePolicyEdits = [
    [
        'import { stat } from "node:fs/promises";',
        'import { stat } from "node:fs/promises";\nimport * as messagePolicyFs from "node:fs/promises";\nimport { join as messagePolicyJoin, isAbsolute as messagePolicyIsAbsolute } from "node:path";',
    ],
    [
        '    const childLogger = logger.child({ module: "agent", component: "paseo-tool-catalog" });',
        '    const childLogger = logger.child({ module: "agent", component: "paseo-tool-catalog" });\n'
            + `    const messagePolicy = (${createAgentMessagePolicy.toString()})({ fs: messagePolicyFs, join: messagePolicyJoin, isAbsolute: messagePolicyIsAbsolute, home: options.paseoHome ?? process.env.PASEO_HOME });`,
    ],
    [
        '        const { disposition } = await sendPromptToAgent({',
        '        await messagePolicy.authorize(callerAgentId, agentId, agentManager, agentStorage);\n        const { disposition } = await sendPromptToAgent({',
    ],
    [
        '    }, async ({ agentId, name, labels, settings }) => {',
        '    }, async ({ agentId, name, labels, settings }) => {\n        messagePolicy.assertLabelUpdate(callerAgentId, labels);',
    ],
];

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
