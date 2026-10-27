import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL('../android/packages/app/src/' + path, import.meta.url), 'utf8');

// 공유 앱은 정책 함수의 결과를 변조하지 않고 안내 소스 자체를 등록하지 않는다.
// 설치된 데스크톱 파일 존재 여부와 무관하게 모든 클라이언트가 사용하는 진입점을 검사한다.
test('shared layout never mounts unsolicited worktree setup', () => {
    const layout = read('app/_layout.tsx');
    assert.doesNotMatch(layout, /WorktreeSetupCalloutSource/);
    assert.match(layout, /SidebarCalloutProvider/);
});

test('shared worktree policy retains manual project settings and rejects invalid projects', () => {
    const source = stripTypeScriptTypes(read('components/worktree-setup-callout-policy.ts'))
        .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
    const policy = runInNewContext(source +
        ';({selectActiveGitWorkspaceProject, buildWorktreeSetupCalloutPolicy})', {
        i18n: { t: key => key },
        buildProjectSettingsRoute: (serverId, projectId) => `/settings/${serverId}/${projectId}`,
    });
    const workspace = { projectKind: 'git', projectId: 'project', projectRootPath: '/repo' };
    const project = policy.selectActiveGitWorkspaceProject('host', workspace);
    assert.deepEqual(JSON.parse(JSON.stringify(project)), {
        serverId: 'host', projectId: 'project', repoRoot: '/repo',
    });
    assert.equal(policy.buildWorktreeSetupCalloutPolicy(project).projectSettingsRoute,
        '/settings/host/project');
    for (const invalid of [
        { ...workspace, projectKind: 'directory' },
        { ...workspace, projectId: ' ' },
        { ...workspace, projectRootPath: ' ' },
    ]) assert.equal(policy.selectActiveGitWorkspaceProject('host', invalid), null);
});
