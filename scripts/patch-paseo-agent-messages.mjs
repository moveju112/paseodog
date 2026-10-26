// Local Apache-2.0 modification: Paseo 0.11.4 authenticated agent-message provenance.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';
import { patchedSteerSource } from './patch-paseo-steer.mjs';
import { agentMessageTransportEdits, agentMessagePolicyEdits } from '../patches/paseo-agent-messages.mjs';
import { ADAPTER_PHASE_EDITS, PROVIDER_PHASE_EDITS, withAssistantPhase, withoutAssistantPhase } from '../patches/paseo-assistant-phase.mjs';
import { MCP_CONFIG_IDENTITY_EDITS, MCP_BOOTSTRAP_IDENTITY_EDITS } from '../patches/paseo-mcp-identity.mjs';
import { SESSION_TITLE_PATCHES, patchedSessionTitleSource } from './patch-paseo-session-titles.mjs';

const provenanceEdits = [[
    '            prompt,\n            sessionMode,\n            logger: childLogger,\n',
    '            prompt,\n            sessionMode,\n            // 호출자가 작성한 본문이 아니라 인증된 MCP 호출 컨텍스트를 전달한다.\n            runOptions: callerAgentId ? { paseodogSource: { kind: "agent", agentId: callerAgentId } } : undefined,\n            logger: childLogger,\n',
]];

export const AGENT_MESSAGE_PATCHES = [
    {
        file: 'dist/server/server/agent/runtime-mcp-config.js',
        blob: 'b55d8dea334abcb7b21465365f671b9eab3d285b',
        edits: MCP_CONFIG_IDENTITY_EDITS,
    },
    {
        file: 'dist/server/server/bootstrap.js',
        blob: '7270675d0098e4853019fae4d65823b969762f79',
        normalize: source => patchedSessionTitleSource(source, SESSION_TITLE_PATCHES.find(spec => spec.file === 'bootstrap.js')),
        edits: MCP_BOOTSTRAP_IDENTITY_EDITS,
    },
    {
        file: 'dist/server/server/agent/tools/paseo-tools.js',
        blob: 'b60d89416317941c9275b0c91df9f2774862b444',
        edits: [...provenanceEdits, ...agentMessagePolicyEdits],
        previousEdits: provenanceEdits,
    },
    {
        file: 'dist/server/server/agent/agent-prompt.js',
        blob: 'e720a291a7ef9f2ac772fcbcaddc10eee37010c4',
        edits: [[
            '    const replaced = Boolean(options?.replaceRunning && agentManager.hasInFlightRun(agentId));',
            '    const replaced = Boolean(!options?.runOptions?.paseodogSource && options?.replaceRunning && agentManager.hasInFlightRun(agentId));',
        ], [
            '    if (agentManager.tryRunOutOfBand(agentId, prompt, options?.runOptions)) {',
            '    if (!options?.runOptions?.paseodogSource && agentManager.tryRunOutOfBand(agentId, prompt, options?.runOptions)) {',
        ], [
            '        if (!isStaleProviderSessionError(error))',
            '        if (options?.runOptions?.paseodogSource || !isStaleProviderSessionError(error))',
        ], [
            '    const snapshot = agentManager.getAgent(agentId);\n    const steered = await steerOrReplaceActiveRun',
            '    const snapshot = agentManager.getAgent(agentId);\n    // 내부 전달은 활성 턴·승인을 교체하거나 실패 후 재전송하지 않는다.\n    if (snapshot?.provider === "paseodog" && options?.runOptions?.paseodogSource && agentManager.hasInFlightRun(agentId)) {\n        const admission = await agentManager.steerAgentRun(agentId, prompt, options.runOptions);\n        if (admission.status === "accepted") return { disposition: "steered" };\n        throw new Error("Agent message was not accepted; active turn preserved, no automatic replay");\n    }\n    const steered = await steerOrReplaceActiveRun',
        ]],
    },
    {
        file: 'dist/server/server/agent/plugin-provider.js',
        blob: 'd7103206aad6675b168f4d17aba5e578a5144d62',
        normalize: patchedSteerSource,
        edits: agentMessageTransportEdits,
    },
];

export const AGENT_MESSAGE_PROTOCOL_PATCH = {
    file: 'dist/server/provider.js',
    blob: 'f66b19fbf51b7a28389563fee663c19beb387838',
    edits: [[
        '    clearPendingPermissions: z.boolean().optional(),',
        '    clearPendingPermissions: z.boolean().optional(),\n    source: z.object({ kind: z.literal("agent"), agentId: idSchema }).strict().optional(),',
    ]],
};

// 원본과 완성된 패치만 허용하며 모든 anchor의 정확한 출현 횟수를 확인한다.
export function patchedAgentMessageSource(source, spec) {
    const phaseEdits = spec.file.endsWith('/plugin-provider.js') ? ADAPTER_PHASE_EDITS
        : spec.file === 'dist/server/provider.js' ? PROVIDER_PHASE_EDITS : [];
    const phaseBase = withoutAssistantPhase(source, phaseEdits);
    const hadPhase = phaseBase !== source;
    source = phaseBase;
    let original = source;
    for (const [before, after] of [...spec.edits].reverse()) original = original.split(after).join(before);
    if (spec.normalize) original = spec.normalize(original);
    if (gitBlob(original) !== spec.blob) throw new Error(`Paseo agent-message source hash mismatch: ${spec.file}`);
    let result = original;
    for (const [before, after] of spec.edits) {
        const count = result.split(before).length - 1;
        const expected = spec.file.endsWith('/agent-prompt.js') && before.includes('isStaleProviderSessionError') ? 2 : 1;
        if (count !== expected) throw new Error(`Paseo agent-message anchor mismatch: ${spec.file}`);
        result = result.split(before).join(after);
    }
    let previous = original;
    for (const [before, after] of spec.previousEdits || []) previous = previous.split(before).join(after);
    if (source !== result && source !== original && source !== previous && (!spec.normalize || spec.normalize(source) !== original))
        throw new Error(`Partial Paseo agent-message patch: ${spec.file}`);
    return hadPhase ? withAssistantPhase(result, phaseEdits) : result;
}

// 서버와 양쪽 SDK 프로토콜을 전부 검증한 뒤 설치 경로에서만 적용한다.
export function patchPaseoAgentMessages(root, protocolRoots, { check = false } = {}) {
    const targets = [
        ...AGENT_MESSAGE_PATCHES.map((spec) => ({ root, spec })),
        ...protocolRoots.map((root) => ({ root, spec: AGENT_MESSAGE_PROTOCOL_PATCH })),
    ];
    const changes = targets.map(({ root, spec }) => {
        if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== '0.11.4')
            throw new Error('Paseo agent messages require 0.11.4');
        const path = resolve(root, spec.file), before = readFileSync(path, 'utf8');
        return { path, before, after: patchedAgentMessageSource(before, spec) };
    });
    if (check && changes.some(({ before, after }) => before !== after)) throw new Error('Paseo agent-message patch is missing');
    for (const { path, before, after } of changes) if (!check && before !== after) writeFileSync(path, after);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    const root = resolve(dirname(self), '..');
    patchPaseoAgentMessages(resolve(root, 'tools/node_modules/@getpaseo/server'), [
        resolve(root, 'tools/node_modules/@getpaseo/plugin'),
        resolve(root, 'plugin/node_modules/@getpaseo/plugin'),
    ], { check: process.argv.includes('--check') });
}
