import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { SIDEBAR_STATUS_SHAPE_EDITS, withSidebarStatusShapes, withoutSidebarStatusShapes } from '../patches/paseo-sidebar-status-shapes.mjs';

const androidRequire = createRequire(new URL('../android/package.json', import.meta.url));
const pluginRequire = createRequire(new URL('../plugin/package.json', import.meta.url));
const { transformSync } = androidRequire('esbuild');
const React = pluginRequire('react');
const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');

test('status shapes preserve the reviewed composer hash gate and reject partial patches', () => {
    const patched = patchedComposerSource(installed);
    const base = withoutSidebarStatusShapes(patched);
    assert.equal(withSidebarStatusShapes(base), patched);
    assert.equal(patchedComposerSource(patched), patched);
    new Script(patched);
    const [before, after] = SIDEBAR_STATUS_SHAPE_EDITS[0];
    assert.throws(() => patchedComposerSource(patched.replace(after, before)), /Partial/);
    assert.throws(() => patchedComposerSource(patched + '// drift'), /hash mismatch/);
    assert.equal(withoutSidebarStatusShapes(base), base);
});

test('workspace status icons distinguish running, completed and needs-input without changing the row', () => {
    const source = readFileSync(new URL('../android/packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx', import.meta.url), 'utf8');
    const component = source.slice(source.indexOf('function WorkspaceStatusIndicator('), source.indexOf('function StatusDotOverlay('));
    const code = transformSync(component, { loader: 'tsx', jsxFactory: 'jsx', format: 'cjs' }).code;
    const styles = { workspaceStatusDot: 'slot', statusAttentionCheck: 'new-response', statusDoneCheck: 'done' };
    const Indicator = new Function('jsx', 'Text', 'View', 'styles', 'StatusRing', 'shouldRenderSyncedStatusLoader',
        'ThemedCircleAlert', 'STATUS_INDICATOR_ALERT_SIZE', 'needsInputColorMapping', 'foregroundMutedColorMapping',
        'ThemedMonitor', 'ThemedFolderGit2', 'ThemedFolder', 'getStatusDotColorStyle', 'StatusDotOverlay',
        `${code}\nreturn WorkspaceStatusIndicator;`)(React.createElement, 'text', 'view', styles, 'ring', ({ bucket }) => bucket === 'running',
        'alert', 12, {}, {}, 'monitor', 'git-folder', 'folder', () => 'danger', 'overlay');
    for (const bucket of ['attention', 'done']) {
        const result = Indicator({ bucket, workspaceKind: 'directory', reserveIdleSpace: false });
        assert.equal(result.props.children.type, 'text');
        assert.equal(result.props.children.props.children, '✓');
        assert.equal(result.props.children.props.accessible, false);
        assert.equal(result.props.style, 'slot');
    }
    assert.equal(Indicator({ bucket: 'running', workspaceKind: 'directory' }).props.children.type, 'ring');
    assert.equal(Indicator({ bucket: 'done', loading: true, workspaceKind: 'directory' }).props.children.type, 'ring');
    assert.equal(Indicator({ bucket: 'needs_input', workspaceKind: 'directory' }).props.children.type, 'alert');
    assert.equal(Indicator({ bucket: 'failed', workspaceKind: 'directory' }).props.children[0].type, 'folder');
});

test('Claude usage catalog supplies the same logo path as the existing shared app asset', () => {
    const reference = readFileSync(new URL('../android/packages/app/assets/icons/claude.svg', import.meta.url), 'utf8');
    const CLAUDE_USAGE_ICON = readFileSync(new URL('../plugin/shared/claude-usage-icon.svg', import.meta.url), 'utf8');
    assert.equal(/<path d="([^"]+)"/.exec(CLAUDE_USAGE_ICON)[1], /<path d="([^"]+)"/.exec(reference)[1]);
    assert.match(CLAUDE_USAGE_ICON, /fill="currentColor"/);
});

// 최근 세션의 실제 행을 실행해 상태 우선순위와 공유 인디케이터 전달을 확인한다.
test('recent session rows use the shared indicator for running, completed, permission and failure states', () => {
    const source = readFileSync(new URL('../android/packages/app/src/components/sidebar/sidebar-recent-sessions.tsx', import.meta.url), 'utf8');
    const component = source.slice(source.indexOf('function RecentSessionRow('), source.indexOf('const styles ='));
    const code = transformSync(component, { loader: 'tsx', jsxFactory: 'jsx', format: 'cjs' }).code;
    const { deriveAgentStateBucket } = androidRequire('@getpaseo/protocol/agent-state-bucket');
    const Row = new Function('jsx', 'useTranslation', 'useCompactTimeAgo', 'useCallback', 'Pressable', 'View', 'Text',
        'WorkspaceStatusIndicator', 'deriveSidebarStateBucket', 'navigateToAgent', 'styles',
        `${code}\nreturn RecentSessionRow;`)(React.createElement, () => ({ t: (key) => key }), () => '1m', (callback) => callback,
        'pressable', 'view', 'text', 'shared-status-indicator', deriveAgentStateBucket, () => {}, {});
    const cases = [
        [{ status: 'running' }, 'running'],
        [{ status: 'idle', requiresAttention: true, attentionReason: 'finished' }, 'attention'],
        [{ status: 'idle' }, 'done'],
        [{ status: 'running', pendingPermissions: [{}] }, 'needs_input'],
        [{ status: 'idle', attentionReason: 'permission' }, 'needs_input'],
        [{ status: 'error' }, 'failed'],
        [{ status: 'idle', attentionReason: 'error' }, 'failed'],
    ];
    for (const [input, expected] of cases) {
        const agent = { id: 'session', serverId: 'server', pendingPermissions: [], ...input };
        const row = Row({ agent });
        const indicator = row.props.children[0].props.children;
        assert.equal(indicator.type, 'shared-status-indicator');
        assert.equal(indicator.props.bucket, expected);
        assert.equal(row.props.testID, 'sidebar-recent-session-server-session');
    }
});
