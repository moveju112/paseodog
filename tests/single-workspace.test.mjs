import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import {
    SINGLE_WORKSPACE_EDITS, withSingleWorkspace, withoutSingleWorkspace,
} from '../patches/paseo-single-workspace.mjs';

const app = new URL('../android/packages/app/', import.meta.url);
const { transformSync } = createRequire(new URL('package.json', app))('esbuild');
const readApp = (path) => readFileSync(new URL(`src/${path}`, app), 'utf8');
const installed = readFileSync(new URL(
    `../tools/node_modules/@getpaseo/server/${COMPOSER_FILE}`, import.meta.url), 'utf8');
const patched = patchedComposerSource(installed);

function evaluateModule(source, id, dependencies) {
    const end = source.indexOf(`},${id},[`);
    const start = source.lastIndexOf('__d(function', end) + '__d('.length;
    const exports = {};
    new Function(`return ${source.slice(start, end + 1)}`)()(globalThis,
        (index) => dependencies[index], null, null, {}, exports, dependencies.map((_, i) => i));
    return exports;
}

function sourceRowModel() {
    const code = transformSync(readApp('utils/sidebar-project-row-model.ts'), {
        loader: 'ts', format: 'cjs',
    }).code;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
    return module.exports.buildSidebarProjectRowModel;
}

const webRowModel = evaluateModule(patched, 4355, [{}]).buildSidebarProjectRowModel;

// 실제 소스·웹 컴포넌트를 동일 입력으로 실행한다. 웹은 컴파일러 캐시를 렌더 사이에 유지한다.
function blockHarness(platform) {
    const actions = [];
    let groupMode = 'project';
    let statusInput;
    const cache = Array(87).fill(Symbol.for('react.memo_cache_sentinel'));
    const jsx = (type, props, ...children) => ({
        type, props: children.length ? { ...props, children } : props,
    });
    const limited = (items) => ({
        visibleItems: items, expanded: false, canToggle: false, toggleExpanded() {},
    });
    const useStore = (select) => select({ groupMode });
    const navigate = (target) => actions.push(['navigate', target]);
    const status = (input) => { statusInput = input; return input.enabled ? 'running' : null; };
    const isActive = ({ selection, project, enabled }) => enabled && project.workspaces.some(
        (workspace) => workspace.serverId === selection?.serverId
            && workspace.workspaceId === selection.workspaceId);
    const selectionKey = (selection) => selection ? `${selection.serverId}:${selection.workspaceId}` : '';
    const keyExtractor = (workspace) => workspace.workspaceKey;
    const state = (value) => [value, () => {}];
    const toast = { error() {} };
    const translate = (key) => key;
    const rowModel = platform === 'source' ? sourceRowModel() : webRowModel;
    let code;
    let name;
    let bindings;
    if (platform === 'source') {
        const source = readApp('components/sidebar-workspace-list.tsx');
        code = transformSync(source.slice(source.indexOf('function ProjectBlock('),
            source.indexOf('type ProjectBlockProps =')), {
            loader: 'tsx', jsxFactory: 'jsx', jsxFragment: 'Fragment',
        }).code;
        name = 'ProjectBlock';
        bindings = {
            useSidebarViewStore: useStore, useMemo: (fn) => fn(), useCallback: (fn) => fn,
            useState: state, useLimitedSidebarGroup: limited, buildSidebarProjectRowModel: rowModel,
            useSidebarProjectStatusBucket: status, isProjectSelectedByRoute: isActive,
            useToast: () => toast, useTranslation: () => ({ t: translate }),
            navigateToWorkspace: navigate, jsx, Fragment: 'Fragment', View: 'View',
            ProjectHeaderRow: 'header', DraggableList: 'workspaces', styles: {},
            workspaceKeyExtractor: keyExtractor, activeWorkspaceSelectionKey: selectionKey,
        };
    } else {
        const start = patched.indexOf('function dr(e){const singleWorkspaceMode=');
        code = patched.slice(start, patched.indexOf('function lr(', start));
        name = 'dr';
        bindings = {
            r: (id) => id === 4072 ? { useSidebarViewStore: useStore } : { navigateToWorkspace: navigate },
            d: Array.from({ length: 15 }, (_, i) => i),
            k: { c: () => cache }, Z: { useLimitedSidebarGroup: limited },
            pe: { buildSidebarProjectRowModel: rowModel },
            A: { useSidebarProjectStatusBucket: status }, Ae: isActive,
            G: { useToast: () => toast }, v: { useTranslation: () => ({ t: translate }) },
            b: { useState: state }, Se: { jsx, jsxs: jsx, Fragment: 'Fragment' },
            h: { View: 'View' }, or: 'header', Tr: {}, C: { DraggableList: 'workspaces' },
            fe: keyExtractor, Ne: selectionKey,
        };
    }
    const component = new Function(...Object.keys(bindings), `${code};return ${name};`)(
        ...Object.values(bindings));
    const workspace = {
        serverId: 'host-b', workspaceId: 'only', workspaceKey: 'host-b:only',
        projectViewKey: 'project', projectKind: 'git',
    };
    const props = {
        project: {
            viewKey: 'project', projectName: 'Project', projectKind: 'git',
            hosts: [{ serverId: 'host-b', projectId: 'project', iconWorkingDir: '/repo',
                worktreeSupport: 'supported' }],
            workspaces: [workspace],
        },
        workspaceEntriesByKey: new Map(), collapsed: false, displayName: 'Project',
        iconDataUri: null, selectionEnabled: true, showShortcutBadges: false,
        shortcutIndexByWorkspaceKey: new Map(), onToggleCollapsed: (key) => actions.push(['toggle', key]),
        onWorkspacePress: () => actions.push(['close']), onWorkspaceReorder() {}, drag() {},
        isDragging: false, useNestable: false, creatingWorkspaceIds: new Set(),
        activeWorkspaceSelection: { serverId: 'host-b', workspaceId: 'only' },
        hostBadgeByServerId: new Map(), supportsMultiplicityByServerId: new Map(),
        supportsPinningByServerId: new Map(), onToggleWorkspacePin() {},
    };
    return {
        actions, props,
        render(mode) {
            groupMode = mode;
            const result = component(props);
            return { header: result.props.children[0].props, children: result.props.children[1], statusInput };
        },
    };
}

test('single workspace patch is reversible, idempotent and refuses drift or partial application', () => {
    const base = withoutSingleWorkspace(patched);
    assert.equal(withSingleWorkspace(base), patched);
    assert.equal(patchedComposerSource(patched), patched);
    assert.throws(() => patchedComposerSource(`${patched}// drift`), /hash mismatch/);
    const [before, after] = SINGLE_WORKSPACE_EDITS[0];
    assert.throws(() => withoutSingleWorkspace(patched.replace(after, before)), /Partial/);
    assert.throws(() => withSingleWorkspace('unexpected upstream'), /anchor mismatch/);
});

for (const platform of ['source', 'web']) {
    test(`${platform}: toggling single mode immediately merges rows, preserves status and opens the correct host`, () => {
        const harness = blockHarness(platform);
        const regular = harness.render('project');
        assert.ok(regular.children);
        regular.header.onPress();
        assert.deepEqual(harness.actions.splice(0), [['toggle', 'project']]);
        const single = harness.render('single');
        assert.equal(single.children, null);
        assert.equal(single.header.selected, true);
        assert.equal(single.header.chevron, null);
        assert.equal(single.header.worktreeTarget, null);
        assert.equal(single.header.statusBucket, 'running');
        assert.equal(single.statusInput.enabled, true);
        single.header.onPress();
        assert.deepEqual(harness.actions.splice(0), [
            ['close'], ['navigate', { serverId: 'host-b', workspaceId: 'only' }],
        ]);
        harness.props.activeWorkspaceSelection = { serverId: 'host-a', workspaceId: 'only' };
        assert.equal(harness.render('single').header.selected, false);
        const restored = harness.render('project');
        assert.ok(restored.children);
        assert.ok(restored.header.worktreeTarget);
        restored.header.onPress();
        assert.deepEqual(harness.actions, [['toggle', 'project']]);
    });

    test(`${platform}: single mode leaves multiple workspaces accessible`, () => {
        const harness = blockHarness(platform);
        harness.props.project.workspaces.push({
            ...harness.props.project.workspaces[0], workspaceId: 'second', workspaceKey: 'host-b:second',
        });
        const result = harness.render('single');
        assert.ok(result.children);
        assert.ok(result.header.worktreeTarget);
        result.header.onPress();
        assert.deepEqual(harness.actions, [['toggle', 'project']]);
    });
}
