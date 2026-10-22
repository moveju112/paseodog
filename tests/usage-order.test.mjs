import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';
import { windowFromReportedDuration } from '../tools/node_modules/@getpaseo/plugin/dist/server/usage.js';
import { COMPOSER_FILE, DESKTOP_COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { USAGE_ORDER_EDITS, withUsageOrder, withoutUsageOrder } from '../patches/paseo-usage-order.mjs';

const { z } = createRequire(new URL('../tools/package.json', import.meta.url))('zod');
const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const patched = patchedComposerSource(installed);
const current = withoutUsageOrder(patched);
const androidPinned = readFileSync(new URL('../android/packages/app/src/usage/pinned.ts', import.meta.url), 'utf8');
const defaults = { displayAs: 'used', pins: null, serverId: null };

// Metro 모듈 하나를 시작 위치에서 잘라 실제 팩토리·id·의존성 id 목록으로 돌려준다.
function parseModule(source, start) {
    const text = source.slice(start + '\n__d('.length, source.indexOf('\n__d(', start + 1));
    const tail = /\},(\d+),\[([\d,]*)\]\);\s*$/.exec(text);
    return {
        id: Number(tail[1]),
        deps: tail[2] ? tail[2].split(',').map(Number) : [],
        factory: new Function(`return ${text.slice(0, tail.index + 1)}`)(),
    };
}

// 사이드바 요약 모듈과 직접 의존 모듈(퍼센트 형식·보고서 모델·기본 핀·단계 색)을 번들 원문 그대로 실행하고 나머지는 zod만 담은 대역으로 둔다.
function loadUsageModules(source) {
    const root = parseModule(source, source.lastIndexOf('\n__d(', source.indexOf('e.resolvePinnedUsage=')));
    const real = new Set([root.id, ...root.deps]);
    const cache = new Map();
    const load = (id) => {
        if (!real.has(id)) return { z };
        if (!cache.has(id)) {
            const module = id === root.id ? root : parseModule(source, source.lastIndexOf('\n__d(', source.indexOf(`},${id},[`)));
            const exports = {};
            cache.set(id, exports);
            module.factory(globalThis, load, null, null, { exports }, exports, module.deps);
        }
        return cache.get(id);
    };
    const [format, model, preferences, tone] = root.deps.map(load);
    return { pinned: load(root.id), format, model, preferences, tone };
}

// Android pinned.ts 원문의 타입만 지우고 같은 호스트 의존 함수(번들 모듈)로 실행한다.
function loadAndroidPinned(modules) {
    const code = stripTypeScriptTypes(androidPinned)
        .replace(/^import \{([^}]*)\} from "\.\/(\w+)";$/gm, 'const {$1} = dependencies.$2;')
        .replace(/^export /gm, '');
    return new Function('dependencies', `${code}\nreturn { resolvePinnedUsage };`)(modules);
}

// 사이드바 보고서 항목 (공급자·계정·창)
function entry(sourceId, sourceLabel, windows, { account, fetchedAt = '2026-10-20T00:00:00.000Z' } = {}) {
    return { id: `${sourceId}:${account ?? 'default'}`, sourceId, sourceLabel, account: account ? { label: account } : {},
        fetchedAt, report: { status: 'available', windows } };
}

// 배열의 모든 순열 (도착 순서 전수 검사용)
function permutations(items) {
    return items.length <= 1 ? [items] : items.flatMap((item, index) =>
        permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]));
}

// 렌더 요약을 공급자 키와 [짧은 이름, 퍼센트] 목록으로 줄인다.
function summary(pinned, reports, preferences = defaults) {
    return pinned.resolvePinnedUsage(reports, preferences)
        .map((source) => [source.key, source.windows.map((window) => [window.shortLabel, window.percentText])]);
}

// Mixdog Claude 보고서(engine/src/usage.mjs 형태: 5H·7D 라벨, 앞 두 창 summary)
const claude = entry('claude', 'Claude', [
    { id: 'claude-0', label: '5H', summary: true, usedPct: 2, remainingPct: 98, resetsAt: null },
    { id: 'claude-1', label: '7D', summary: true, usedPct: 64, remainingPct: 36, resetsAt: null },
]);
// 내장 Codex 보고서는 호스트 SDK의 실제 창 이름 함수로 만든다(18000초 -> 5h, 604800초 -> wk).
const codexWindow = (durationSeconds, utilizationPct, extra = {}) => windowFromReportedDuration({
    durationSeconds, unknown: { id: 'unknown_primary', label: 'Primary limit', shortLabel: '' }, utilizationPct, resetsAt: null, ...extra });
const codex = entry('codex', 'Codex', [
    codexWindow(18000, 0, { summary: true }),
    codexWindow(604800, 97, { summary: true }),
    codexWindow(604800, 1, { scope: { id: 'code_review', label: 'Code review' } }),
]);
const grok = entry('grok', 'Grok', [
    { id: 'weekly', label: 'Weekly', shortLabel: 'wk', summary: true, usedPct: 5, remainingPct: 95, resetsAt: null },
    { id: 'monthly', label: 'Monthly', shortLabel: 'mo', summary: true, usedPct: 9, remainingPct: 91, resetsAt: null },
]);
const cursor = entry('cursor', 'Cursor', [{ id: 'plan', label: 'Plan', shortLabel: '', summary: true, usedPct: 40, remainingPct: 60, resetsAt: null }]);
const expected = [
    ['claude:default', [['5H', '2%'], ['7D', '64%']]],
    ['codex:default', [['5h', '0%'], ['7D', '97%']]],
];

test('sidebar usage order patch is hash gated, idempotent and reversible', () => {
    assert.deepEqual(codex.report.windows.map((window) => [window.id, window.shortLabel]),
        [['five_hour', '5h'], ['weekly', 'wk'], ['code_review:weekly', 'Code review wk']]);
    assert.equal(withoutUsageOrder(current), current);
    assert.equal(withUsageOrder(current), patched);
    assert.equal(patchedComposerSource(patched), patched);
    assert.equal(patchedComposerSource(current), patched);
    new Script(patched);
    for (const [before, after] of USAGE_ORDER_EDITS) {
        assert.equal(patched.split(after).length, 2);
        assert.equal(patched.includes(before), false);
        assert.equal(current.split(before).length, 2);
    }
    assert.equal(withoutUsageOrder(withoutUsageOrder(patched)), current);
    assert.throws(() => withUsageOrder(patched), /anchor mismatch/);
    assert.throws(() => withUsageOrder(current.replace(USAGE_ORDER_EDITS[1][0], '')), /anchor mismatch/);
    assert.throws(() => withoutUsageOrder(patched + USAGE_ORDER_EDITS[0][1]), /drift/);
    const partial = patched.replace(USAGE_ORDER_EDITS[1][1], USAGE_ORDER_EDITS[1][0]);
    assert.throws(() => withoutUsageOrder(partial), /Partial Paseo usage order/);
    assert.throws(() => patchedComposerSource(partial), /Partial Paseo usage order/);
    const drifted = current.replace(USAGE_ORDER_EDITS[0][0], USAGE_ORDER_EDITS[0][0].replace('flatMap', 'map'));
    assert.throws(() => patchedComposerSource(drifted), /hash mismatch/);
    // 이전 Codex -> Claude 순서 패치도 새 Claude -> Codex 순서로 교체된다.
    const legacy = patched.replace('["claude","codex"].indexOf', '["codex","claude"].indexOf');
    assert.notEqual(legacy, patched);
    assert.equal(withoutUsageOrder(legacy), current);
    assert.equal(patchedComposerSource(legacy), patched);
});

test('sidebar shows Claude before Codex whichever report or update arrives first', () => {
    const original = loadUsageModules(current);
    const { pinned, model } = loadUsageModules(patched);
    // 원본은 도착 순서를 따라 Claude/Codex 위치가 바뀌고 주간 창을 wk로 보인다.
    assert.deepEqual(summary(original.pinned, [claude, codex]).map(([key]) => key), ['claude:default', 'codex:default']);
    assert.deepEqual(summary(original.pinned, [codex, claude]), [
        ['codex:default', [['5h', '0%'], ['wk', '97%']]], ['claude:default', [['5H', '2%'], ['7D', '64%']]]]);
    for (const reports of permutations([claude, codex])) {
        const before = [...reports];
        assert.deepEqual(summary(pinned, reports), expected);
        assert.deepEqual(reports, before);
        // 스트리밍 upsert 도착 순서와 서버 확정(settle) 순서가 달라도 같은 순서다.
        const streamed = reports.reduce((list, report) => model.upsertReport(list, report), undefined);
        assert.deepEqual(summary(pinned, streamed), expected);
        assert.deepEqual(summary(pinned, model.settleReports(streamed, [...reports].reverse())), expected);
        const refreshed = entry('claude', 'Claude', [{ ...claude.report.windows[0], usedPct: 3, remainingPct: 97 }, claude.report.windows[1]],
            { fetchedAt: '2026-10-20T00:05:00.000Z' });
        assert.deepEqual(summary(pinned, model.upsertReport(streamed, refreshed)),
            [['claude:default', [['5H', '3%'], ['7D', '64%']]], expected[1]]);
    }
    for (const reports of permutations([grok, claude, cursor, codex]))
        assert.deepEqual(summary(pinned, reports).map(([key]) => key), ['claude:default', 'codex:default', 'cursor:default', 'grok:default']);
});

test('only weekly wk becomes 7D; 5H, other labels, values, tones and accessible labels stay', () => {
    const original = loadUsageModules(current).pinned;
    const { pinned } = loadUsageModules(patched);
    const pins = { ...defaults, pins: [
        { sourceId: 'codex', windowId: 'five_hour' }, { sourceId: 'codex', windowId: 'weekly' },
        { sourceId: 'codex', windowId: 'code_review:weekly' }, { sourceId: 'claude', windowId: 'claude-0' },
        { sourceId: 'claude', windowId: 'claude-1' }, { sourceId: 'grok', windowId: 'weekly' }, { sourceId: 'grok', windowId: 'monthly' },
    ] };
    for (const preferences of [pins, { ...pins, displayAs: 'remaining' }]) {
        const reports = [claude, codex, grok];
        const before = original.resolvePinnedUsage(reports, preferences);
        const after = pinned.resolvePinnedUsage(reports, preferences);
        assert.deepEqual(after, before.map((source) => ({ ...source, windows: source.windows.map((window) =>
            ({ ...window, shortLabel: window.shortLabel === 'wk' ? '7D' : window.shortLabel })) })));
        assert.deepEqual(after.flatMap((source) => source.windows.map((window) => window.shortLabel)),
            ['5H', '7D', '5h', '7D', 'Code review wk', '7D', 'mo']);
    }
    const [weekly] = pinned.resolvePinnedUsage([codex], { ...defaults, pins: [{ sourceId: 'codex', windowId: 'weekly' }] })[0].windows;
    assert.deepEqual(weekly, { key: 'codex:default/weekly', label: 'Codex Weekly 97% used', shortLabel: '7D', percent: 97,
        percentText: '97%', tone: 'danger', resetsAt: null });
});

test('Android pinned source renders the same fixed order and labels as the patched web bundle', () => {
    const modules = loadUsageModules(patched);
    const android = loadAndroidPinned(modules);
    const work = entry('claude', 'Claude', [{ id: 'claude-1', label: '7D', usedPct: 70, remainingPct: 30, resetsAt: null }], { account: 'work' });
    const preferenceSets = [defaults, { ...defaults, displayAs: 'remaining' },
        { ...defaults, pins: [{ sourceId: 'claude', windowId: 'claude-1' }, { sourceId: 'codex', windowId: 'weekly' }, { sourceId: 'grok', windowId: 'weekly' }] }];
    for (const reports of permutations([work, grok, claude, codex])) {
        for (const preferences of preferenceSets)
            assert.deepEqual(android.resolvePinnedUsage(reports, preferences), modules.pinned.resolvePinnedUsage(reports, preferences));
    }
    assert.deepEqual(summary(android, [work, claude, codex]), [expected[0], ['claude:work', [['7D', '70%']]], expected[1]]);
});

test('reviewed desktop bundle renders the same fixed sidebar usage order', { skip: !existsSync(DESKTOP_COMPOSER_FILE) }, () => {
    const desktop = patchedComposerSource(readFileSync(DESKTOP_COMPOSER_FILE, 'utf8'));
    assert.equal(withUsageOrder(withoutUsageOrder(desktop)), desktop);
    assert.deepEqual(summary(loadUsageModules(desktop).pinned, [claude, codex]), expected);
});
