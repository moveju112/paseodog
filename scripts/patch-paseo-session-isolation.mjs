// MCP 호출자 인증은 유지하고 공개 세션 간 송신 도구는 제거한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';
import { MCP_CONFIG_IDENTITY_EDITS, MCP_BOOTSTRAP_IDENTITY_EDITS, withoutMcpIdentity, withMcpIdentity } from '../patches/paseo-mcp-identity.mjs';
import { SESSION_TITLE_PATCHES, patchedSessionTitleSource } from './patch-paseo-session-titles.mjs';
import { PROVIDER_PHASE_EDITS, withoutAssistantPhase, withAssistantPhase } from '../patches/paseo-assistant-phase.mjs';

const catalogBlob = 'b60d89416317941c9275b0c91df9f2774862b444';
const isolatedCatalogBlob = '1502905aa0be52f9dde31a80638b9422adb037cb';
const legacyPolicyPattern = /    const messagePolicy = \([\s\S]*?\)\(\{ fs: messagePolicyFs, join: messagePolicyJoin, isAbsolute: messagePolicyIsAbsolute, home: options.paseoHome \?\? process.env.PASEO_HOME \}\);/;

function withoutLegacyMessagePolicy(source) {
    const policy = source.match(legacyPolicyPattern)?.[0];
    if (policy) {
        if (createHash('sha256').update(policy).digest('hex') !== '5081b918231d8ace172a61b6bfb4a00e524a59ce55690ce856c18bdde649eeda')
            throw new Error('Previous session policy source hash mismatch');
        source = source.replace('\n' + policy, '');
    }
    return source
        .replace('\nimport * as messagePolicyFs from "node:fs/promises";', '')
        .replace('\nimport { join as messagePolicyJoin, isAbsolute as messagePolicyIsAbsolute } from "node:path";', '')
        .replace('        await messagePolicy.authorize(callerAgentId, agentId, agentManager, agentStorage);\n', '')
        .replace('        messagePolicy.assertLabelUpdate(callerAgentId, labels);\n', '')
        .replace('            // 호출자가 작성한 본문이 아니라 인증된 MCP 호출 컨텍스트를 전달한다.\n            runOptions: callerAgentId ? { paseodogSource: { kind: "agent", agentId: callerAgentId } } : undefined,\n', '');
}

function withoutLegacyPromptTransport(source) {
    return source
        .replace('    const replaced = Boolean(!options?.runOptions?.paseodogSource && options?.replaceRunning && agentManager.hasInFlightRun(agentId));',
            '    const replaced = Boolean(options?.replaceRunning && agentManager.hasInFlightRun(agentId));')
        .replace('    if (!options?.runOptions?.paseodogSource && agentManager.tryRunOutOfBand(agentId, prompt, options?.runOptions)) {',
            '    if (agentManager.tryRunOutOfBand(agentId, prompt, options?.runOptions)) {')
        .replaceAll('        if (options?.runOptions?.paseodogSource || !isStaleProviderSessionError(error))',
            '        if (!isStaleProviderSessionError(error))')
        .replace('    // 내부 전달은 활성 턴·승인을 교체하거나 실패 후 재전송하지 않는다.\n    if (snapshot?.provider === "paseodog" && options?.runOptions?.paseodogSource && agentManager.hasInFlightRun(agentId)) {\n        const admission = await agentManager.steerAgentRun(agentId, prompt, options.runOptions);\n        if (admission.status === "accepted") return { disposition: "steered" };\n        throw new Error("Agent message was not accepted; active turn preserved, no automatic replay");\n    }\n', '');
}

const protocolCleanup = {
    file: 'dist/server/provider.js',
    blob: 'f66b19fbf51b7a28389563fee663c19beb387838',
};

export function patchedToolCatalogSource(source) {
    if (gitBlob(source) === isolatedCatalogBlob) return source;
    source = withoutLegacyMessagePolicy(source);
    if (gitBlob(source) !== catalogBlob) throw new Error('Paseo tool catalog source hash mismatch');
    for (const pattern of [
        /^import \{ sendPromptToAgent, setupFinishNotification, waitForAgentRunStartWithTimeout, \} from "\.\.\/agent-prompt.js";\n/m,
        /    const commonSendAgentPromptInputSchema = \{[\s\S]*?(?=    const inspectProviderInputSchema = \{)/,
        /    const PROMPTED_AGENT_NOTIFICATION_GUIDANCE = [\s\S]*?(?=    registerTool\("get_agent_status",)/,
    ]) {
        if ([...source.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))].length !== 1)
            throw new Error('Paseo session isolation anchor mismatch');
        source = source.replace(pattern, '');
    }
    const anchor = '    }, async ({ agentId, name, labels, settings }) => {\n';
    source = source.replace(anchor, anchor
        + '        if (callerAgentId && labels && Object.hasOwn(labels, "paseo.parent-agent-id")) {\n'
        + '            throw new Error("Agent parent relationship is assigned by the server at creation");\n        }\n');
    if (gitBlob(source) !== isolatedCatalogBlob) throw new Error('Paseo session isolation output hash mismatch');
    return source;
}

export const PASEO_ISOLATION_PATCHES = [
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
    { file: 'dist/server/server/agent/tools/paseo-tools.js' },
    {
        file: 'dist/server/server/agent/agent-prompt.js',
        blob: 'e720a291a7ef9f2ac772fcbcaddc10eee37010c4',
        cleanup: withoutLegacyPromptTransport,
    },
];

export function patchedSessionIsolationSource(source, spec) {
    if (spec.file.endsWith('/paseo-tools.js')) return patchedToolCatalogSource(source);
    if (spec.cleanup) {
        const result = spec.cleanup(source);
        if (gitBlob(result) !== spec.blob) throw new Error(`Previous session transport source hash mismatch: ${spec.file}`);
        return result;
    }
    if (spec.file === protocolCleanup.file) {
        const base = withoutAssistantPhase(source, PROVIDER_PHASE_EDITS);
        const result = base.replace('\n    source: z.object({ kind: z.literal("agent"), agentId: idSchema }).strict().optional(),', '');
        if (gitBlob(result) !== spec.blob) throw new Error('Previous session protocol source hash mismatch');
        return base === source ? result : withAssistantPhase(result, PROVIDER_PHASE_EDITS);
    }
    let original = withoutMcpIdentity(source, spec.edits);
    if (spec.normalize) original = spec.normalize(original);
    if (gitBlob(original) !== spec.blob) throw new Error(`Paseo MCP identity source hash mismatch: ${spec.file}`);
    return withMcpIdentity(original, spec.edits);
}

export function patchPaseoSessionIsolation(root, { check = false, protocolRoots = [] } = {}) {
    if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== '0.11.4')
        throw new Error('Paseo session isolation requires 0.11.4');
    const targets = [
        ...PASEO_ISOLATION_PATCHES.map(spec => ({ root, spec })),
        ...protocolRoots.map(root => ({ root, spec: protocolCleanup })),
    ];
    const changes = targets.map(({ root, spec }) => {
        if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== '0.11.4')
            throw new Error('Paseo protocol cleanup requires 0.11.4');
        const path = resolve(root, spec.file), before = readFileSync(path, 'utf8');
        return { path, before, after: patchedSessionIsolationSource(before, spec) };
    });
    if (check && changes.some(({ before, after }) => before !== after))
        throw new Error('Paseo session isolation patch is missing');
    for (const { path, before, after } of changes)
        if (!check && before !== after) writeFileSync(path, after);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self)
    patchPaseoSessionIsolation(resolve(dirname(self), '../tools/node_modules/@getpaseo/server'),
        { check: process.argv.includes('--check'), protocolRoots: [
            resolve(dirname(self), '../tools/node_modules/@getpaseo/plugin'),
            resolve(dirname(self), '../plugin/node_modules/@getpaseo/plugin'),
        ] });
