import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createClaudeUsageSource } from '../plugin/server/usage.ts';
import { readPluginProviderIcon } from '../android/packages/server/src/server/plugins/provider-icon.ts';
import { COMPOSER_FILE, DESKTOP_COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { usageDonutEdits, createUsageSummaryTrigger, donutArcRotations, usageCountdownText, usageTooltipText, usageIconSvg, withUsageDonut,
    withoutUsageDonut } from '../patches/paseo-usage-donut.mjs';

const { z } = createRequire(new URL('../tools/package.json', import.meta.url))('zod');
const pluginRequire = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = pluginRequire('react');
const { jsx, jsxs } = pluginRequire('react/jsx-runtime');
const { create, act } = pluginRequire('react-test-renderer');
const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const patched = patchedComposerSource(installed);
const current = withoutUsageDonut(patched);

// 번들 Metro 모듈 하나를 시작 위치에서 잘라 팩토리로 실행한다(의존 모듈은 zod 대역).
function loadBundleModule(source, marker) {
    const start = source.lastIndexOf('\n__d(', source.indexOf(marker));
    const text = source.slice(start + '\n__d('.length, source.indexOf('\n__d(', start + 1));
    const tail = /\},(\d+),\[([\d,]*)\]\);\s*$/.exec(text);
    const factory = new Function(`return ${text.slice(0, tail.index + 1)}`)();
    const exports = {};
    factory(globalThis, () => ({ z }), null, null, { exports }, exports, tail[2].split(',').map(Number));
    return exports;
}

// Android donut-model.ts 원문의 타입만 지워 실행한다.
function loadAndroidDonutModel() {
    const code = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/usage/donut-model.ts', import.meta.url), 'utf8'))
        .replace(/^export /gm, '');
    return new Function(`${code}\nreturn { usageCountdownText, usageTooltipText, usageIconSvg, donutArcRotations, DONUT_SIZE, DONUT_STROKE };`)();
}

test('sidebar usage donut patch is hash gated, idempotent and reversible', () => {
    new Script(patched);
    assert.equal(withUsageDonut(current), patched);
    assert.equal(patchedComposerSource(current), patched);
    assert.equal(patchedComposerSource(patched), patched);
    const edits = usageDonutEdits(current);
    for (const [before, after] of edits) {
        assert.equal(patched.split(after).length, 2);
        assert.equal(current.split(before).length, 2);
    }
    // 툴팁은 번들의 실제 TooltipContent 모듈을 Metro 번호로 불러온다.
    const tooltipId = /\},(\d+),\[/.exec(patched.slice(patched.indexOf('e.TooltipContent=function')))[1];
    assert.ok(patched.includes(`TooltipContent:r(${tooltipId}).TooltipContent`));
    assert.throws(() => withUsageDonut(patched), /anchor mismatch/);
    const partial = patched.replace(edits[0][1], edits[0][0]);
    assert.throws(() => patchedComposerSource(partial), /Partial Paseo usage donut/);
    // 이전 버전(공급자 이름 편집 없음·다른 트리거 본문)도 새 패치로 교체된다.
    const labelEdit = edits.find(([before]) => before === '[{key:l.id,icon:l.icon??null,windows:s}]');
    const legacy = patched.replace(labelEdit[1], labelEdit[0]).replace('tooltipText:function usageTooltipText', 'legacy:function usageTooltipText');
    assert.equal(patchedComposerSource(legacy), patched);
});

test('bundle preferences keep donuts only and the setter stores the choice', () => {
    const preferences = loadBundleModule(patched, 'e.setUsageSidebarStyle=');
    const defaults = preferences.DEFAULT_USAGE_PREFERENCES;
    const donut = preferences.setUsageSidebarStyle(defaults, 'donut');
    assert.deepEqual(preferences.UsagePreferencesSchema.parse(donut), { ...defaults, sidebarStyle: 'donut' });
    for (const sidebarStyle of ['bar', 'ring', 3, undefined])
        assert.deepEqual(preferences.UsagePreferencesSchema.parse({ ...defaults, sidebarStyle }), defaults);
});

test('Android donut model matches the bundle countdown and arc math', () => {
    const android = loadAndroidDonutModel();
    assert.deepEqual([android.DONUT_SIZE, android.DONUT_STROKE], [30, 3]);
    const now = Date.parse('2026-10-21T00:00:00.000Z');
    const at = (seconds) => new Date(now + seconds * 1000).toISOString();
    const cases = [[null, '--:--'], ['nope', '--:--'], [at(-5), '0:00'], [at(30), '0:01'], [at(53 * 60 + 59), '0:53'],
        [at(6 * 3600 + 13 * 60), '6:13'], [at(86399), '23:59'], [at(86400), '1D'], [at(6.5 * 86400), '6D']];
    for (const [resetsAt, text] of cases) {
        assert.equal(usageCountdownText(resetsAt, now), text, String(resetsAt));
        assert.equal(android.usageCountdownText(resetsAt, now), text, String(resetsAt));
    }
    assert.deepEqual(donutArcRotations(0), { right: null, left: null });
    assert.deepEqual(donutArcRotations(25), { right: 135, left: null });
    assert.deepEqual(donutArcRotations(50), { right: 225, left: null });
    assert.deepEqual(donutArcRotations(75), { right: 225, left: -45 });
    assert.deepEqual(donutArcRotations(140), { right: 225, left: 45 });
    for (let percent = -10; percent <= 110; percent += 0.5)
        assert.deepEqual(android.donutArcRotations(percent), donutArcRotations(percent));
    const sources = [{ label: 'Codex', windows: [{ shortLabel: '5h', percentText: '0%' }, { shortLabel: '7D', percentText: '97%' }] },
        { label: 'Claude (work)', windows: [{ shortLabel: '', percentText: '31%' }] }];
    assert.equal(usageTooltipText(sources), 'Codex: 5h 0% / 7D 97%\nClaude (work): 31%');
    assert.equal(android.usageTooltipText(sources), usageTooltipText(sources));
});

test('summary trigger draws donuts with countdowns and falls back to the bar trigger', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const theme = { spacing: { 1.5: 6, 2: 8, 4: 16 }, borderRadius: { lg: 8 }, fontSize: { sm: 12, base: 14 },
        colors: { surfaceSidebarHover: 'hover', surface3: 'track', foregroundMuted: 'muted', foreground: 'text', popoverForeground: 'popover',
            statusSuccess: 'ok', statusWarning: 'warning', statusDanger: 'danger' } };
    let style = 'donut';
    const Trigger = createUsageSummaryTrigger({
        React, jsx, jsxs, View: 'view', Text: 'text', SourceIcon: 'icon',
        usePreferences: () => ({ preferences: style === 'donut' ? { sidebarStyle: 'donut' } : {} }),
        StyleSheet: { create: (factory) => factory(theme) }, BarTrigger: 'bar',
        Tooltip: 'tooltip', TooltipTrigger: 'tooltip-trigger', TooltipContent: 'tooltip-content',
        describe: (label, sources) => `${label}: ${sources.length}`, countdown: usageCountdownText, rotations: donutArcRotations,
        tooltipText: usageTooltipText, iconSvg: usageIconSvg,
    });
    const resetsAt = new Date(Date.now() + (53 * 60 + 30) * 1000).toISOString();
    const sources = [{ key: 'claude', sourceId: 'claude', label: 'Claude', icon: '<svg fill="currentColor"/>', windows: [
        { key: 'claude/5h', shortLabel: '5H', percent: 80, percentText: '80%', tone: 'warning', resetsAt },
        { key: 'claude/7d', shortLabel: '7D', percent: 95, percentText: '95%', tone: 'danger', resetsAt: null },
    ] }];
    let tree;
    await act(async () => { tree = create(jsx(Trigger, { label: 'Usage', sources, onPress() {} })); });
    const cells = tree.root.findAll((node) => node.props.testID === 'sidebar-usage-pinned-window' && node.type === 'view');
    assert.equal(cells.length, 2);
    const texts = tree.root.findAllByType('text').map((node) => node.props.children);
    assert.deepEqual(texts, ['5H', '0:53', '7D', '--:--', 'Claude: 5H 80% / 7D 95%']);
    const trigger = tree.root.findByType('tooltip-trigger');
    assert.equal(trigger.props.style({ hovered: false }).justifyContent, 'center');
    assert.equal(trigger.props.style({ hovered: false }).columnGap, 16);
    assert.equal(trigger.props.style({ hovered: false }).paddingVertical, 0);
    assert.equal(trigger.props.style({ hovered: false }).marginVertical, -6);
    assert.equal(tree.root.findByType('tooltip').props.delayDuration, 300);
    assert.equal(tree.root.findByType('tooltip-content').props.maxWidth, 560);
    const arcs = tree.root.findAll((node) => node.type === 'view' && Array.isArray(node.props.style) && node.props.style.length === 4);
    assert.deepEqual(arcs.map((node) => [node.props.style[2].borderLeftColor, node.props.style[3].transform[0].rotate]),
        [['warning', '225deg'], ['warning', '-27deg'], ['danger', '225deg'], ['danger', '27deg']]);
    assert.equal(trigger.props.accessibilityLabel, 'Usage: 1');
    assert.deepEqual(tree.root.findAllByType('icon').map((node) => node.props.svg),
        ['<svg fill="#D97757"/>', '<svg fill="#D97757"/>']);
    style = 'bar';
    await act(async () => tree.update(jsx(Trigger, { label: 'Usage', sources, onPress() {} })));
    assert.equal(tree.root.findAllByType('bar').length, 1);
    await act(async () => tree.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test('provider icons use blue Codex and orange Claude without tinting other sources', () => {
    const android = loadAndroidDonutModel();
    const svg = '<svg fill="currentColor"><path stroke="currentColor"/></svg>';
    for (const [sourceId, color] of [['codex', '#3B82F6'], ['claude', '#D97757']]) {
        const expected = `<svg fill="${color}"><path stroke="${color}"/></svg>`;
        assert.equal(usageIconSvg(svg, sourceId), expected);
        assert.equal(android.usageIconSvg(svg, sourceId), expected);
    }
    assert.equal(usageIconSvg(null, 'claude'), null);
    assert.equal(usageIconSvg(svg, 'other'), svg);
});

// 실제 SDK의 경로·SVG 검사를 통과한 Claude 로고만 카탈로그와 도넛에 전달한다.
test('Claude catalog icon is a readable plugin-relative SVG accepted by the real SDK loader', async () => {
    const source = createClaudeUsageSource({ usage: async () => { throw new Error('Usage must not be queried by icon validation'); } });
    const svg = await readPluginProviderIcon(fileURLToPath(new URL('../plugin/', import.meta.url)), source.icon);
    assert.equal(svg, readFileSync(new URL('../plugin/shared/claude-usage-icon.svg', import.meta.url), 'utf8'));
    assert.ok(usageIconSvg(svg, 'claude').includes('fill="#D97757"'));
});

test('reviewed desktop bundle accepts the same donut patch', { skip: !existsSync(DESKTOP_COMPOSER_FILE) }, () => {
    const desktop = patchedComposerSource(readFileSync(DESKTOP_COMPOSER_FILE, 'utf8'));
    assert.equal(withUsageDonut(withoutUsageDonut(desktop)), desktop);
});
