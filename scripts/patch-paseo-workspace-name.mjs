// 로컬 패치: 프로젝트명을 임시 작업공간 이름으로 쓰고 완료된 대화 관찰자가 자동 제목을 확정한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';

export const WORKSPACE_NAME_PATCHES = [
    {
        file: 'dist/server/server/agent/create-agent-title.js',
        blob: '353ee3d0d6088f6af6401c502aef8b728c531efe',
        edits: [[
            'export function resolveFirstAgentPromptTitle(firstAgentContext) {\n    return (resolveCreateAgentTitles({\n        initialPrompt: firstAgentContext?.prompt,\n    }).provisionalTitle ?? null);\n}\n',
            'export function resolveFirstAgentPromptTitle(firstAgentContext) {\n    // PaseoDog: 첫 프롬프트로 작업공간 이름을 만들지 않는다. 기본 이름은 프로젝트 표시 이름이다.\n    return null;\n}\n',
        ]],
    },
    {
        file: 'dist/server/server/workspace-auto-name.js',
        blob: 'aadeb609cb9da8dc776a23052574cd7e8aee7a11',
        edits: [[
            '    scheduleForDirectory(input, context = {}) {\n        this.schedule(() => this.maybeAutoNameDirectoryWorkspaceTitle({\n            ...input,\n            currentSelection: context.currentSelection ?? null,\n        }), { cwd: input.cwd, message: "Failed to auto-name directory workspace title" });\n    }\n',
            '    scheduleForDirectory(input, context = {}) {\n        // PaseoDog: 디렉터리 작업공간은 이름만 생성되므로 AI 이름 생성을 호출하지 않는다.\n    }\n',
        ], [
            '        if (!generated) {\n            generated = await this.generateFromContext({\n                cwd: input.workspace.cwd,\n                firstAgentContext: input.firstAgentContext,\n                currentSelection: input.currentSelection,\n            });\n        }\n        const generatedTitle = generated?.title ?? null;\n        if (!generatedTitle) {\n            return;\n        }\n        // K4: re-read from the registry before writing so any concurrent upsert\n        // that happened between workspace creation and this async path is not clobbered.\n        // When the first-agent rename changed the git branch too, persist that branch\n        // alongside the title — both are this path\'s own fields.\n        await this.applyGeneratedWorkspaceTitle(input.workspace.workspaceId, {\n            title: generatedTitle,\n            ...(result.renamed ? { branch: result.branchName } : {}),\n            promptTitle: resolveFirstAgentPromptTitle(input.firstAgentContext),\n        });\n        if (result.renamed) {\n            await this.gitMutation.notifyGitMutation(worktreeRoot, "rename-branch");\n        }\n',
            '        // PaseoDog: AI 이름은 첫 에이전트 브랜치에만 쓰고 작업공간 이름에는 쓰지 않는다.\n        if (!result.renamed) {\n            return;\n        }\n        // K4: re-read from the registry before writing so any concurrent upsert\n        // that happened between workspace creation and this async path is not clobbered.\n        await this.applyGeneratedWorkspaceTitle(input.workspace.workspaceId, {\n            branch: result.branchName,\n        });\n        await this.gitMutation.notifyGitMutation(worktreeRoot, "rename-branch");\n',
        ], [
            '            let title = current.title;\n            if (!title || (input.promptTitle && title === input.promptTitle)) {\n                title = input.title;\n            }\n            return {\n                ...current,\n                title,\n',
            '            // PaseoDog: 기본·명시·변경한 작업공간 이름은 그대로 두고 브랜치만 반영한다.\n            return {\n                ...current,\n',
        ]],
    },
    {
        file: 'dist/server/server/session/workspace-provisioning/workspace-provisioning-service.js',
        blob: '408745af59cab48e3127c4ce6e710164518e614a',
        edits: [[
            'import { createPersistedWorkspaceRecord, } from "../../workspace-registry.js";\n',
            'import { createPersistedWorkspaceRecord, resolveProjectDisplayName, } from "../../workspace-registry.js";\n',
        ], [
            '            title: title?.trim() || null,\n',
            '            title: title?.trim() || resolveProjectDisplayName(project),\n            titleOrigin: title?.trim() ? "user" : "provisional",\n',
        ], [
            '            title: input.title,\n',
            '            title: input.title?.trim() || resolveProjectDisplayName(project),\n            titleOrigin: input.title?.trim() ? "user" : "provisional",\n',
        ]],
    },
];

// 원본 또는 완성된 패치만 허용하고 각 anchor가 정확히 한 번 나오는지 확인한다.
export function patchedWorkspaceNameSource(source, spec) {
    const legacy = source.replace('            titleOrigin: title?.trim() ? "user" : "provisional",\n', '')
        .replace('            titleOrigin: input.title?.trim() ? "user" : "provisional",\n', '');
    let original = source;
    if (spec.file.endsWith('workspace-provisioning-service.js')) {
        original = legacy.replace('            title: title?.trim() || resolveProjectDisplayName(project),\n', '            title: title?.trim() || null,\n')
            .replace('            title: input.title?.trim() || resolveProjectDisplayName(project),\n', '            title: input.title,\n');
    }
    for (const [before, after] of [...spec.edits].reverse()) original = original.split(after).join(before);
    if (gitBlob(original) !== spec.blob) throw new Error(`Paseo workspace-name source hash mismatch: ${spec.file}`);
    let result = original;
    for (const [before, after] of spec.edits) {
        if (result.split(before).length !== 2) throw new Error(`Paseo workspace-name anchor mismatch: ${spec.file}`);
        result = result.replace(before, after);
    }
    const legacyResult = result.replace('            titleOrigin: title?.trim() ? "user" : "provisional",\n', '')
        .replace('            titleOrigin: input.title?.trim() ? "user" : "provisional",\n', '');
    if (source !== original && source !== result && source !== legacyResult)
        throw new Error(`Partial Paseo workspace-name patch: ${spec.file}`);
    return result;
}

// 세 파일을 모두 검증한 뒤에만 쓰고, 검토한 0.11.4 서버 설치본에만 적용한다.
export function patchPaseoWorkspaceName(root, { check = false } = {}) {
    if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== '0.11.4')
        throw new Error('Paseo workspace name requires 0.11.4');
    const changes = WORKSPACE_NAME_PATCHES.map((spec) => {
        const path = resolve(root, spec.file), before = readFileSync(path, 'utf8');
        return { path, before, after: patchedWorkspaceNameSource(before, spec) };
    });
    if (check && changes.some(({ before, after }) => before !== after)) throw new Error('Paseo workspace-name patch is missing');
    for (const { path, before, after } of changes) if (!check && before !== after) writeFileSync(path, after);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    patchPaseoWorkspaceName(resolve(dirname(self), '../tools/node_modules/@getpaseo/server'), {
        check: process.argv.includes('--check'),
    });
}
