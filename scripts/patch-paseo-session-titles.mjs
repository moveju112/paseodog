// 로컬 Apache-2.0 패치: Paseo 0.11.4 대화 완료 후 자동 제목과 수동 제목 출처를 영속화한다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';

const storageMethod = `    // 저장 큐 안에서 이전 제목·출처·보관 상태를 함께 검사한다.
    async setGeneratedTitle(agentId, title, expectedTitle, isCurrent = () => true) {
        await this.load();
        let applied = false;
        await this.queueRecordMutation(agentId, (existing) => {
            if (!isCurrent() || !existing || existing.archivedAt || existing.title !== expectedTitle ||
                !["provisional", "generated"].includes(existing.titleOrigin ?? "")) return existing;
            applied = true;
            return { ...existing, title, titleOrigin: "generated" };
        });
        return applied;
    }
`;
const managerMethod = `    // 자동 제목은 활동 시각을 바꾸지 않고 저장소 출처 검사를 거친다.
    async setGeneratedTitle(agentId, title, expectedTitle, isCurrent = () => true) {
        const agent = this.agents.get(agentId);
        if (!agent || agent.internal || !this.registry) return;
        if (await this.registry.setGeneratedTitle(agentId, title, expectedTitle, isCurrent))
            this.emitState(agent, { persist: false });
    }
`;
const bootstrap = `    const stopConversationTitles = startConversationTitles({
        agentManager, agentStorage, workspaceRegistry,
        generateTitle: (input) => pluginRuntime.invokePluginRpc("paseodog-provider", "engine-title", input),
        emitWorkspaceUpdate: (workspaceId) => emitWorkspaceUpdatesExternal([workspaceId]),
        logger,
    });
`;

export const SESSION_TITLE_PATCHES = [
    { file: 'agent/create-agent/create.js', blob: '1af258a082e337413e3cd4e713c8afe8f8fb3c61', edits: [
        ['    const { provisionalTitle } = resolveCreateAgentTitles({',
            '    const { explicitTitle } = resolveCreateAgentTitles({'],
        ['    if (provisionalTitle) {\n        config.title = provisionalTitle;',
            '    if (explicitTitle) {\n        config.title = explicitTitle;'],
        ['            workspaceId: intent.workspaceId,\n            owner: input.owner,',
            '            workspaceId: intent.workspaceId,\n            initialTitle: resolveCreateAgentTitles({ initialPrompt: trimmedPrompt }).provisionalTitle,\n            owner: input.owner,'],
    ] },
    { file: 'agent/agent-storage.js', blob: '57727b9a773b43fda41ac59d27fda479ca5e4da0', edits: [
        ['    title: z.string().nullable().optional(),',
            '    title: z.string().nullable().optional(),\n    titleOrigin: z.enum(["provisional", "generated", "user"]).optional(),'],
        ['            await this.writeRecord(record);', '            if (record) await this.writeRecord(record);'],
        ['            return record;\n        });\n    }\n    async setTitle(',
            '            record.titleOrigin = options?.titleOrigin ?? existing?.titleOrigin;\n'
            + '            if (!existing && !record.titleOrigin) record.titleOrigin = agent.config.title?.trim() ? "user" : "provisional";\n'
            + '            return record;\n        });\n    }\n    async setTitle('],
        ['        await this.upsert({ ...record, title });', '        await this.upsert({ ...record, title, titleOrigin: "user" });'],
        ['    async flush() {', storageMethod + '    async flush() {'],
    ] },
    { file: 'agent/agent-manager.js', blob: '0055aa5201583fa24bdc61327b182104640aff6c', edits: [
        ['        await this.persistSnapshot(agent, { title: normalizedTitle });',
            '        await this.persistSnapshot(agent, { title: normalizedTitle, titleOrigin: "user" });'],
        ['    async setLabels(agentId, labels) {', managerMethod + '    async setLabels(agentId, labels) {'],
        ['            ...(patch.title ? { title: patch.title } : {}),',
            '            ...(patch.title ? { title: patch.title, titleOrigin: "user" } : {}),'],
    ] },
    { file: 'workspace-registry.js', blob: '2356056fc5daf5aeb06eaf66aa73a3ef3abd6027', edits: [
        ['const PersistedWorkspaceRecordSchema = z.object({\n    workspaceId: z.string(),',
            'const PersistedWorkspaceRecordSchema = z.object({\n    workspaceId: z.string(),\n    titleOrigin: z.enum(["provisional", "generated", "user"]).optional(),'],
    ] },
    { file: 'session.js', blob: '658d767c9fbcf2cdb3b386477b939485524ad8dd', edits: [
        ['                title: nextTitle,\n                updatedAt,',
            '                title: nextTitle,\n                titleOrigin: "user",\n                updatedAt,'],
    ] },
    { file: 'bootstrap.js', blob: 'd8fb50959b05740a3a5ec250036867f982b5ff18', edits: [
        ['import { WorkspaceAutoName } from "./workspace-auto-name.js";',
            'import { WorkspaceAutoName } from "./workspace-auto-name.js";\nimport { startConversationTitles } from "./conversation-titles.js";'],
        ['    setupAutoArchiveOnMerge({', bootstrap + '    setupAutoArchiveOnMerge({'],
        ['    const stop = async () => {', '    const stop = async () => {\n        stopConversationTitles();'],
    ] },
];

// 원본·완성된 패치만 받으며 모든 파일의 정확한 blob과 유일한 앵커를 검증한다.
export function patchedSessionTitleSource(source, spec) {
    let original = source;
    for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
    if (gitBlob(original) !== spec.blob) throw new Error(`Paseo session-title source hash mismatch: ${spec.file}`);
    let result = original;
    for (const [before, after] of spec.edits) {
        if (result.split(before).length !== 2) throw new Error(`Paseo session-title anchor mismatch: ${spec.file}`);
        result = result.replace(before, after);
    }
    if (source !== original && source !== result) throw new Error(`Partial Paseo session-title patch: ${spec.file}`);
    return result;
}

// 공용 관찰자 원본을 타입만 제거해 패키지 옆에 설치하고, 대상 다섯 파일을 모두 검증 후 적용한다.
export function patchPaseoSessionTitles(root, { check = false } = {}) {
    if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== '0.11.4')
        throw new Error('Paseo session titles require 0.11.4');
    const base = resolve(root, 'dist/server/server');
    const changes = SESSION_TITLE_PATCHES.map((spec) => {
        const path = resolve(base, spec.file), before = readFileSync(path, 'utf8');
        return { path, before, after: patchedSessionTitleSource(before, spec) };
    });
    const observer = resolve(base, 'conversation-titles.js');
    const content = stripTypeScriptTypes(readFileSync(new URL('../android/packages/server/src/server/conversation-titles.ts', import.meta.url), 'utf8'));
    if (existsSync(observer) && readFileSync(observer, 'utf8') !== content)
        throw new Error('Paseo conversation-title observer source drift');
    if (check && (!existsSync(observer) || changes.some(({ before, after }) => before !== after)))
        throw new Error('Paseo session-title patch is missing');
    if (!check) {
        writeFileSync(observer, content);
        for (const { path, before, after } of changes) if (before !== after) writeFileSync(path, after);
    }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    patchPaseoSessionTitles(resolve(dirname(self), '../tools/node_modules/@getpaseo/server'), {
        check: process.argv.includes('--check'),
    });
}
