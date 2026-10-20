import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    WORKSPACE_NAME_PATCHES, patchPaseoWorkspaceName, patchedWorkspaceNameSource,
} from '../scripts/patch-paseo-workspace-name.mjs';

const serverRoot = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url);
const serverRequire = createRequire(new URL('package.json', serverRoot));
const TITLE = 'dist/server/server/agent/create-agent-title.js';
const AUTO_NAME = 'dist/server/server/workspace-auto-name.js';
const PROVISIONING = 'dist/server/server/session/workspace-provisioning/workspace-provisioning-service.js';
const specs = new Map(WORKSPACE_NAME_PATCHES.map((spec) => [spec.file, spec]));
const installed = (file) => readFileSync(new URL(file, serverRoot), 'utf8');

// 설치본이 패치 전·후 어느 상태든 검토한 원본 바이트로 되돌린다.
function originalOf(file) {
    let source = patchedWorkspaceNameSource(installed(file), specs.get(file));
    for (const [before, after] of [...specs.get(file).edits].reverse()) source = source.replace(after, before);
    return source;
}

// 설치본을 바꾸지 않고 패치한 서버 모듈을 설치 경로 기준 import로 바꿔 메모리에서 실행한다.
async function loadPatched(file, overrides = {}) {
    const fileUrl = new URL(file, serverRoot);
    const source = patchedWorkspaceNameSource(installed(file), specs.get(file));
    const rewritten = source.replace(/from "([^"]+)"/g, (match, specifier) => {
        if (specifier.startsWith('node:')) return match;
        const target = specifier.startsWith('.')
            ? new URL(specifier, fileUrl).href
            : pathToFileURL(serverRequire.resolve(specifier)).href;
        return `from "${overrides[target] ?? target}"`;
    });
    const url = `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`;
    return { url, module: await import(url) };
}

// 실제 프로비저닝 서비스에 메모리 저장소와 비git 체크아웃만 연결한다.
async function provisioningHarness(project) {
    const { module } = await loadPatched(PROVISIONING);
    const records = [];
    const projects = new Map([[project.projectId, project]]);
    const service = module.createWorkspaceProvisioningService({
        workspaceRegistry: { async upsert(record) { records.push(record); }, async list() { return records; } },
        projectRegistry: {
            async get(projectId) { return projects.get(projectId) ?? null; },
            async upsert(record) { projects.set(record.projectId, record); },
        },
        workspaceGitService: {
            async getCheckout() {
                return { isGit: false, currentBranch: null, remoteUrl: null, worktreeRoot: null,
                    isPaseoOwnedWorktree: false, mainRepoRoot: null };
            },
        },
        isDirectory: async () => true,
        logger: { info() {}, warn() {}, error() {} },
    });
    return service;
}

const project = (customName) => ({
    projectId: 'prj_shop', rootPath: '/srv/shop', kind: 'non_git', projectKey: 'key',
    displayName: 'shop', customName, archivedAt: null,
    createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
});

test('workspace-name patch is exact-blob gated, idempotent and refuses drift or partial bytes', () => {
    for (const spec of WORKSPACE_NAME_PATCHES) {
        const patched = patchedWorkspaceNameSource(installed(spec.file), spec);
        assert.notEqual(patched, originalOf(spec.file));
        assert.equal(patchedWorkspaceNameSource(originalOf(spec.file), spec), patched);
        assert.equal(patchedWorkspaceNameSource(patched, spec), patched);
        assert.throws(() => patchedWorkspaceNameSource(patched + '// drift', spec), /hash mismatch/);
        if (spec.edits.length > 1) {
            const [before, after] = spec.edits.at(-1);
            assert.throws(() => patchedWorkspaceNameSource(patched.replace(after, before), spec), /Partial/);
        }
    }
});

test('workspace-name patch applies only to a reviewed 0.11.4 copy and supports --check', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-workspace-name-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.11.4' }));
    for (const { file } of WORKSPACE_NAME_PATCHES) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), originalOf(file));
    }
    assert.throws(() => patchPaseoWorkspaceName(root, { check: true }), /patch is missing/);
    patchPaseoWorkspaceName(root);
    patchPaseoWorkspaceName(root, { check: true });
    patchPaseoWorkspaceName(root);
    for (const spec of WORKSPACE_NAME_PATCHES)
        assert.equal(readFileSync(join(root, spec.file), 'utf8'), patchedWorkspaceNameSource(installed(spec.file), spec));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.11.5' }));
    assert.throws(() => patchPaseoWorkspaceName(root, { check: true }), /requires 0\.11\.4/);
});

test('first prompts no longer name workspaces while agent session titles keep prompt and explicit titles', async () => {
    const { module: titles } = await loadPatched(TITLE);
    assert.equal(titles.resolveFirstAgentPromptTitle({ prompt: 'Fix the login bug' }), null);
    assert.deepEqual(titles.resolveCreateAgentTitles({ initialPrompt: 'Fix the login bug\nmore' }),
        { explicitTitle: null, provisionalTitle: 'Fix the login bug' });
    assert.deepEqual(titles.resolveCreateAgentTitles({ configTitle: ' Mine ', initialPrompt: 'Fix' }),
        { explicitTitle: 'Mine', provisionalTitle: 'Mine' });
});

test('new directory and worktree workspaces default to the project display name, explicit names win', async () => {
    const { module: titles } = await loadPatched(TITLE);
    const { resolveWorkspaceDisplayName } = await import(new URL('dist/server/server/workspace-registry.js', serverRoot));
    const custom = await provisioningHarness(project('Shop App'));
    // 세션 경로와 같은 입력: 명시 이름이 없으면 첫 프롬프트 제목을 넘긴다.
    const explicitTitle = null;
    const prompted = await custom.createWorkspaceForDirectory('/srv/shop',
        explicitTitle ?? titles.resolveFirstAgentPromptTitle({ prompt: 'Fix the login bug' }), 'prj_shop');
    assert.equal(prompted.title, 'Shop App');
    assert.equal(resolveWorkspaceDisplayName(prompted), 'Shop App');
    assert.equal((await custom.createWorkspaceForDirectory('/srv/shop', '  Release prep ', 'prj_shop')).title, 'Release prep');
    const worktree = { sourceCwd: '/srv/shop', projectId: 'prj_shop', repoRoot: '/srv/shop',
        cwd: '/srv/wt/a', worktreeRoot: '/srv/wt/a', branch: 'paseo/a', baseBranch: 'main', title: null };
    assert.equal((await custom.createWorkspaceForWorktree(worktree)).title, 'Shop App');
    assert.equal((await custom.createWorkspaceForWorktree({ ...worktree, title: ' Hotfix ' })).title, 'Hotfix');
    const plain = await provisioningHarness(project(null));
    assert.equal((await plain.createWorkspaceForDirectory('/srv/shop/sub', null, 'prj_shop')).title, 'shop');
    assert.equal((await plain.createWorkspaceForWorktree({ ...worktree, title: '' })).title, 'shop');
});

test('auto-name never calls AI for workspace titles and never overwrites default, explicit or renamed titles', async (t) => {
    const { url: titleUrl } = await loadPatched(TITLE);
    const { module } = await loadPatched(AUTO_NAME, { [new URL(TITLE, serverRoot).href]: titleUrl });
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'paseodog-workspace-auto-name-'));
    t.after(() => rmSync(worktreeRoot, { recursive: true, force: true }));
    const generated = [], emitted = [], warnings = [], runs = [];
    let record = { workspaceId: 'wks_1', title: 'Renamed by user', branch: 'paseo/a' };
    const autoName = new module.WorkspaceAutoName({
        agentManager: {}, workspaceGitService: {}, providerSnapshotManager: {}, readDaemonConfig: () => ({}),
        gitMutation: { async notifyGitMutation() { throw new Error('unexpected branch mutation'); } },
        workspaceRegistry: { async update(workspaceId, apply) { assert.equal(workspaceId, 'wks_1'); record = apply(record); } },
        emitWorkspaceUpdateForCwd: async (cwd) => emitted.push(cwd),
        emitWorkspaceUpdateForWorkspaceId: async (workspaceId) => emitted.push(workspaceId),
        logger: { warn: (...args) => warnings.push(args) },
        generateWorkspaceName: async () => { generated.push(1); return { branch: 'feat/login', title: 'Fix login flow' }; },
    });
    autoName.schedule = (run) => runs.push(run());
    const firstAgentContext = { prompt: 'Fix the login bug' };
    autoName.scheduleForDirectory({ workspaceId: 'wks_1', cwd: worktreeRoot, firstAgentContext });
    autoName.scheduleForWorktree({ workspace: { workspaceId: 'wks_1', cwd: worktreeRoot, worktreeRoot }, firstAgentContext });
    await Promise.all(runs);
    assert.equal(runs.length, 1);
    assert.deepEqual({ generated, emitted, warnings }, { generated: [], emitted: [], warnings: [] });
    assert.equal(record.title, 'Renamed by user');
    // 첫 에이전트 브랜치 이름 변경은 유지하되 제목은 기본·명시·삭제 상태 그대로 둔다.
    for (const title of ['Shop App', 'Renamed by user', null]) {
        record = { workspaceId: 'wks_1', title, branch: 'paseo/a' };
        await autoName.applyGeneratedWorkspaceTitle('wks_1', { title: 'Fix login flow', branch: 'feat/login', promptTitle: title });
        assert.equal(record.title, title);
        assert.equal(record.branch, 'feat/login');
    }
});
