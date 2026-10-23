import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, DESKTOP_COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';

const originalPolicy = 'e.shouldShowWorktreeSetupCallout=function(t){return!0===t?.ok&&!n(t.config??{})}';
const hiddenPolicy = 'e.shouldShowWorktreeSetupCallout=function(t){return!1}';

// 실제 번들의 정책 모듈을 실행해 설정 팁 판단과 수동 설정 경로를 검사한다.
function loadPolicy(source) {
    const at = source.indexOf('e.shouldShowWorktreeSetupCallout=function');
    assert.notEqual(at, -1);
    const start = source.lastIndexOf('__d(', at);
    const end = source.indexOf('\n', at);
    const policy = {};
    const dependencies = [
        { i18n: { t: (key) => key } },
        { buildProjectSettingsRoute: (serverId, projectId) => `/settings/${serverId}/${projectId}` },
    ];
    new Script(source.slice(start, end)).runInNewContext({
        __d: (factory) => factory(null, (value) => value, null, null, null, policy, dependencies),
    });
    return policy;
}

for (const [client, path] of [
    ['web', new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url)],
    ['desktop', DESKTOP_COMPOSER_FILE],
]) {
    test(`${client} never promotes worktree setup and retains manual project settings`, {
        skip: client === 'desktop' && !existsSync(path),
    }, () => {
        const source = readFileSync(path, 'utf8');
        const patched = composerFixture(source);
        assert.equal(composerFixture(patched), patched);
        new Script(patched);
        const policy = loadPolicy(patched);
        const original = loadPolicy(patched.replace(hiddenPolicy, originalPolicy));
        assert.equal(original.shouldShowWorktreeSetupCallout({ ok: true, config: {} }), true);
        for (const response of [
            undefined, null, { ok: false }, { ok: true }, { ok: true, config: {} },
            ...[undefined, '', '  ', [], [''], 'npm ci', ['npm ci']].map((setup) => ({
                ok: true, config: { worktree: { setup } },
            })),
        ]) {
            assert.equal(policy.shouldShowWorktreeSetupCallout(response), false);
        }
        const workspace = { projectKind: 'git', projectId: 'project', projectRootPath: '/repo' };
        const project = policy.selectActiveGitWorkspaceProject('host', workspace);
        assert.equal(JSON.stringify(project), JSON.stringify(original.selectActiveGitWorkspaceProject('host', workspace)));
        assert.equal(JSON.stringify(policy.buildWorktreeSetupCalloutPolicy(project)),
            JSON.stringify(original.buildWorktreeSetupCalloutPolicy(project)));
        assert.equal(policy.buildWorktreeSetupCalloutPolicy(project).projectSettingsRoute, '/settings/host/project');
        assert.throws(() => patchedComposerSource(patched.replace(hiddenPolicy,
            'e.shouldShowWorktreeSetupCallout=function(t){return!0}')), /source hash mismatch/);
    });
}
