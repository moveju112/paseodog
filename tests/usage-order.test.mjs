import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { windowFromReportedDuration } from '../tools/node_modules/@getpaseo/plugin/dist/server/usage.js';

const require = createRequire(new URL('../android/package.json', import.meta.url));
const { buildSync } = require('esbuild');
const defaults = { displayAs: 'used', pins: null, serverId: null };

// 앱·서버 웹·데스크톱의 공통 구현과 실제 의존성을 함께 컴파일한다.
// 사라진 npm 웹 번들의 모듈 번호나 패치 전 코드에는 의존하지 않는다.
const compiled = buildSync({
    stdin: { contents: 'export * as pinned from "./pinned"; export * as model from "./model";',
        resolveDir: fileURLToPath(new URL('../android/packages/app/src/usage/', import.meta.url)) },
    tsconfig: fileURLToPath(new URL('../android/packages/app/tsconfig.json', import.meta.url)),
    bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const { pinned, model } = module.exports;

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

test('host duration windows retain their canonical ids and labels', () => {
    assert.deepEqual(codex.report.windows.map((window) => [window.id, window.shortLabel]),
        [['five_hour', '5h'], ['weekly', 'wk'], ['code_review:weekly', 'Code review wk']]);
});

test('sidebar shows Claude before Codex whichever report or update arrives first', () => {
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
    const pins = { ...defaults, pins: [
        { sourceId: 'codex', windowId: 'five_hour' }, { sourceId: 'codex', windowId: 'weekly' },
        { sourceId: 'codex', windowId: 'code_review:weekly' }, { sourceId: 'claude', windowId: 'claude-0' },
        { sourceId: 'claude', windowId: 'claude-1' }, { sourceId: 'grok', windowId: 'weekly' }, { sourceId: 'grok', windowId: 'monthly' },
    ] };
    for (const preferences of [pins, { ...pins, displayAs: 'remaining' }]) {
        const reports = [claude, codex, grok];
        const after = pinned.resolvePinnedUsage(reports, preferences);
        // 기대값은 출력의 다른 실행이 아니라 입력 보고서에서 독립적으로 계산한다.
        for (const source of after) {
            const report = reports.find(entry => entry.id === source.key);
            for (const window of source.windows) {
                const input = report.report.windows.find(item => `${report.id}/${item.id}` === window.key);
                const percent = preferences.displayAs === 'remaining' ? input.remainingPct : input.usedPct;
                assert.equal(window.percent, percent);
                assert.equal(window.percentText, `${Math.round(percent)}%`);
                assert.equal(window.label, `${report.sourceLabel} ${input.label} ${Math.round(percent)}% ${preferences.displayAs === 'remaining' ? 'left' : 'used'}`);
            }
        }
        assert.deepEqual(after.flatMap((source) => source.windows.map((window) => window.shortLabel)),
            ['5H', '7D', '5h', '7D', 'Code review wk', '7D', 'mo']);
    }
    const [weekly] = pinned.resolvePinnedUsage([codex], { ...defaults, pins: [{ sourceId: 'codex', windowId: 'weekly' }] })[0].windows;
    assert.deepEqual(weekly, { key: 'codex:default/weekly', label: 'Codex Weekly 97% used', shortLabel: '7D', percent: 97,
        percentText: '97%', tone: 'danger', resetsAt: null });
});

test('shared clients preserve account order for every arrival order and preference', () => {
    const work = entry('claude', 'Claude', [{ id: 'claude-1', label: '7D', usedPct: 70, remainingPct: 30, resetsAt: null }], { account: 'work' });
    const preferenceSets = [defaults, { ...defaults, displayAs: 'remaining' },
        { ...defaults, pins: [{ sourceId: 'claude', windowId: 'claude-1' }, { sourceId: 'codex', windowId: 'weekly' }, { sourceId: 'grok', windowId: 'weekly' }] }];
    for (const reports of permutations([work, grok, claude, codex])) {
        for (const preferences of preferenceSets)
            assert.deepEqual(pinned.resolvePinnedUsage(reports, preferences),
                pinned.resolvePinnedUsage([claude, work, codex, grok], preferences));
    }
    assert.deepEqual(summary(pinned, [work, claude, codex]), [expected[0], ['claude:work', [['7D', '70%']]], expected[1]]);
});

test('shared usage hides unavailable reports and honors explicitly empty pins', () => {
    assert.deepEqual(summary(pinned, [claude, codex], { ...defaults, pins: [] }), []);
    assert.deepEqual(summary(pinned, [{ ...claude, report: { status: 'unavailable' } }, codex]), [expected[1]]);
});
