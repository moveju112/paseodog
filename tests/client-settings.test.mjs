import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const { build } = require('esbuild');
const React = require('react');
const { create, act } = require('react-test-renderer');

// 테스트 호스트 모듈로 클라이언트 번들 생성 (실제 RPC 정의 -> rpc 이름별 테스트 응답)
async function loadClient(t, { compact = true } = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-client-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const output = join(directory, 'client.cjs');
    await build({
        entryPoints: [fileURLToPath(new URL('../plugin/index.client.tsx', import.meta.url))],
        bundle: true, platform: 'node', format: 'cjs', outfile: output,
        plugins: [{
            name: 'test-host',
            setup(builder) {
                builder.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve('react'), external: true }));
                builder.onResolve({ filter: /^(react-native|@getpaseo\/plugin(?:\/client(?:\/react-native)?)?)$/ },
                    ({ path }) => ({ path, namespace: 'host' }));
                builder.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({
                    contents: path === '@getpaseo/plugin'
                        ? 'export const defineRpc = value => value;'
                        : path === '@getpaseo/plugin/client'
                            ? 'export const useRpc = (rpc) => (input) => globalThis.__paseodogTestRpc(input, rpc.name);'
                            : path === '@getpaseo/plugin/client/react-native'
                                ? 'import React from "react"; export const Icon="icon", ScrollView="scroll"; export const Modal=Object.assign(({open,onOpenChange,...props})=>React.createElement("modal",{...props,open,visible:open,onRequestClose:()=>onOpenChange(false)}),{Content:({children})=>React.createElement("modal-content",null,children)});'
                                : 'export const Pressable="pressable", Text="text", TextInput="input", View="view", ScrollView="scroll", Modal="modal", KeyboardAvoidingView="keyboard-view"; export const Platform={OS:"android"}; export const Linking={openURL:async (url)=>{globalThis.__paseodogOpenedUrls.push(url);}}; export const AppState={currentState:"active",addEventListener:()=>({remove(){}})};',
                }));
            },
        }],
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.__paseodogOpenedUrls = [];
    const mounted = [];
    // 렌더링한 화면을 모두 해제한 뒤 테스트 전역값 정리
    t.after(async () => {
        for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
        delete globalThis.__paseodogTestRpc;
        delete globalThis.__paseodogOpenedUrls;
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    });
    const settingsScreens = [];
    const screens = [];
    const panels = [];
    let liveScreen;
    let footer;
    require(output).default({
        addSettingsScreen(value) { settingsScreens.push(value); return () => {}; },
        addScreen(value) { screens.push(value); if (value.id === 'mixdog-live') liveScreen = value; return () => {}; },
        addWorkspacePanel(value) { panels.push(value); return () => {}; },
        addSidebarFooterItem(value) { footer = value; return () => {}; },
    });
    // 설정 화면 렌더링과 라벨 기반 버튼 누르기 도우미
    const renderScreen = async (screen) => {
        let tree;
        await act(async () => {
            tree = create(React.createElement(screen.Component, {
                theme: { colors: { foreground: '#ffffff' } }, host: { id: 'test', label: 'test' },
                layout: { compact, platform: compact ? 'android' : 'web' },
            }));
        });
        mounted.push(tree);
        return screenHelpers(tree);
    };
    return { settingsScreens, screens, panels, liveScreen, footer, renderScreen };
}

async function showUsageDetails(tree) {
    await act(async () => tree.root.findAllByType('pressable')
        .find(node => node.props.accessibilityLabel === '사용량 자세히').props.onPress());
}

for (const compact of [true, false]) {
    test(`summary prioritizes measured tok/s and Fast markers without refetching (compact=${compact})`, async t => {
        const { footer, renderScreen } = await loadClient(t, { compact });
        let calls = 0;
        globalThis.__paseodogTestRpc = async () => {
            calls++;
            return {
                range: { fromMs: 1, toMs: 2 }, totals: { outputTokensPerSecond: 99.9, turns: 3, tokens: 1000 },
                providers: [{ provider: 'openai-oauth', providerKind: 'oauth', label: 'Codex',
                    outputTokensPerSecond: 38.2, turns: 3, tokens: 1000, models: [] }], series: [], quotas: [],
                efforts: [
                    { provider: 'openai-oauth', model: 'test', agent: 'worker', effort: 'high', fast: true, outputTokensPerSecond: 40, turns: 1 },
                    { provider: 'openai-oauth', model: 'test', agent: 'worker', effort: 'high', fast: false, outputTokensPerSecond: 20, turns: 1 },
                    { provider: 'openai-oauth', model: 'test', agent: 'worker', effort: 'high', fast: null, outputTokensPerSecond: null, turns: 1 },
                ],
            };
        };
        const { tree } = await renderScreen(footer);
        const button = label => tree.root.findAllByType('pressable').find(node => node.props.accessibilityLabel === label);
        const content = () => tree.root.findAllByType('text').map(node => node.children.join('')).join('\n');
        await act(async () => button('AI 사용량·에이전트 분석').props.onPress());
        assert.equal(button('사용량 요약').props.accessibilityState.selected, true);
        // 합계가 아니라 제공자별 측정값을 보여준다.
        assert.ok(content().includes('38.2 tok/s') && !content().includes('99.9 tok/s'));
        assert.ok(!content().includes('환산액') && !content().includes('추이') && !content().includes('Effort'));
        await showUsageDetails(tree);
        assert.equal(button('사용량 자세히').props.accessibilityState.selected, true);
        for (const [fast, marker, value] of [['켜짐', 'O', '40.0'], ['꺼짐', '', '20.0'], ['미기록', '', '—']]) {
            const row = tree.root.findAllByType('view')
                .find(node => node.props.accessibilityLabel === `worker openai-oauth test high Fast ${fast} 사용량`);
            const cells = row.findAllByType('text').map(node => node.children.join(''));
            assert.equal(cells[2], marker);
            assert.ok(cells.includes(value));
        }
        await act(async () => button('사용량 요약').props.onPress());
        assert.ok(!content().includes('에이전트·Effort'));
        assert.equal(calls, 1);
    });
}

test('plugin registers tools and diagnostics but no duplicate settings screens', async t => {
    const { settingsScreens, screens, panels, liveScreen } = await loadClient(t);
    assert.deepEqual(settingsScreens, []);
    assert.equal(panels.find(item => item.id === 'mixdog-live').Component, liveScreen.Component);
    assert.ok(panels.some(item => item.id === 'mixdog-session-tools'));
    assert.ok(screens.some(item => item.id === 'paseodog-native-config'));
});

test('bottom sidebar icon opens analysis as a modal and releases it on close', async (t) => {
    const { footer, renderScreen } = await loadClient(t);
    const calls = [];
    globalThis.__paseodogTestRpc = async (input, name) => {
        calls.push(name);
        return { range: { fromMs: 1, toMs: 2 }, totals: {}, series: [], providers: [], quotas: [] };
    };
    assert.equal(footer.id, 'paseodog-analysis');
    const { tree } = await renderScreen(footer);
    assert.equal(calls.length, 0);
    const button = (label) => tree.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === label);
    await act(async () => button('AI 사용량·에이전트 분석').props.onPress());
    assert.equal(tree.root.findByType('modal').props.visible, true);
    assert.deepEqual(calls, ['engine-metrics']);
    await act(async () => button('분석 모달 닫기').props.onPress());
    assert.equal(tree.root.findByType('modal').props.visible, false);
    assert.equal(button('분석 모달 닫기'), undefined);
});

test('usage shows independent agent/effort rows even without provider model summaries', async (t) => {
    const { footer, renderScreen } = await loadClient(t);
    globalThis.__paseodogTestRpc = async () => ({
        range: { fromMs: 1, toMs: 2 }, totals: {},
        providers: [],
        efforts: [
            { provider: 'openai', model: 'test', agent: 'worker', effort: 'low', turns: 1, tokens: 10 },
            { provider: 'openai', model: 'test', agent: null, effort: null, turns: 2, tokens: 20 },
        ],
        series: [], quotas: [],
    });
    const { tree } = await renderScreen(footer);
    await act(async () => tree.root.findAllByType('pressable')
        .find((node) => node.props.accessibilityLabel === 'AI 사용량·에이전트 분석').props.onPress());
    await showUsageDetails(tree);
    const labels = tree.root.findAllByType('view').map((node) => node.props.accessibilityLabel);
    assert.ok(labels.includes('worker openai test low Fast 미기록 사용량'));
    assert.ok(labels.includes('에이전트 미기록 openai test effort 미기록 Fast 미기록 사용량'));
    const content = tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
    assert.ok(content.includes('에이전트·Effort'));
    assert.ok(labels.includes('worker 에이전트 사용량'));
    assert.ok(labels.includes('에이전트 미기록 에이전트 사용량'));
    // 요약 지표 다음에 OAuth 한도 → 토큰 → 제공자·모델 → 에이전트·Effort 순서로 배치한다.
    const order = ['OAuth 한도', '추이', '제공자·모델', '에이전트·Effort'].map((title) => content.indexOf(title));
    assert.ok(order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1])), String(order));
});

// 같은 에이전트·모델의 effort는 한 묶음에 모으고, 제공자·모델·에이전트·미기록 값은 따로 유지한다.
test('usage groups effort rows by agent then provider model without repeating headings', async (t) => {
    const { footer, renderScreen } = await loadClient(t, { compact: false });
    globalThis.__paseodogTestRpc = async () => ({
        range: { fromMs: 1, toMs: 2 }, totals: {}, providers: [], series: [], quotas: [],
        efforts: [
            { provider: 'openai', model: 'gpt', agent: 'worker', effort: 'low', turns: 1, tokens: 10, costUsd: 0.1 },
            { provider: 'openai', model: 'gpt', agent: 'reviewer', effort: 'high', turns: 4, tokens: 40, costUsd: 0.4 },
            { provider: 'openai', model: 'gpt', agent: 'worker', effort: 'high', turns: 2, tokens: 20, costUsd: 0.2 },
            { provider: 'azure', model: 'gpt', agent: 'worker', effort: 'low', turns: 3, tokens: 30, costUsd: 0.3 },
            { provider: 'openai', model: 'mini', agent: 'worker', effort: null, turns: 5, tokens: 50, costUnpricedTurns: 5 },
            { provider: 'openai', model: 'gpt', agent: null, effort: null, turns: 6, tokens: 60, costUsd: 0.6 },
        ],
    });
    const { tree } = await renderScreen(footer);
    await act(async () => tree.root.findAllByType('pressable')
        .find((node) => node.props.accessibilityLabel === 'AI 사용량·에이전트 분석').props.onPress());
    await showUsageDetails(tree);
    const views = tree.root.findAllByType('view');
    const groups = views.filter((node) => node.props.accessibilityLabel?.endsWith(' 에이전트 사용량'));
    assert.deepEqual(groups.map((node) => node.props.accessibilityLabel),
        ['worker 에이전트 사용량', 'reviewer 에이전트 사용량', '에이전트 미기록 에이전트 사용량']);
    const texts = (node) => node.findAllByType('text').map((item) => item.children.join(''));
    // 표 행: 모델 이름은 같은 모델의 첫 effort 행에만 쓰고 나머지 행은 비운다.
    const rows = (group) => group.findAllByType('view').filter((node) => node.props.accessibilityLabel?.endsWith(' 사용량')
        && !node.props.accessibilityLabel.endsWith(' 에이전트 사용량'));
    assert.deepEqual(rows(groups[0]).map((row) => texts(row)), [
        ['openai · gpt', 'low', '', '—', '1', '10'],
        ['', 'high', '', '—', '2', '20'],
        ['azure · gpt', 'low', '', '—', '3', '30'],
        ['openai · mini', '미기록', '', '—', '5', '50'],
    ]);
    assert.deepEqual(rows(groups[1]).map((row) => texts(row)), [['openai · gpt', 'high', '', '—', '4', '40']]);
    assert.deepEqual(rows(groups[2]).map((row) => texts(row)), [['openai · gpt', '미기록', '', '—', '6', '60']]);
    assert.deepEqual(rows(groups[0]).map((row) => row.props.accessibilityLabel).slice(0, 2),
        ['worker openai gpt low Fast 미기록 사용량', 'worker openai gpt high Fast 미기록 사용량']);
    // 표 머리글은 에이전트 묶음마다 한 번만 표시한다.
    assert.equal(texts(groups[0]).filter((value) => value === 'Effort').length, 1);
});

test('effort section remains visible with missing or empty historical detail', async (t) => {
    const { footer, renderScreen } = await loadClient(t);
    for (const extra of [{}, { efforts: [] }]) {
        globalThis.__paseodogTestRpc = async () => ({
            range: { fromMs: 1, toMs: 2 }, totals: {}, providers: [], series: [], quotas: [], ...extra,
        });
        const { tree } = await renderScreen(footer);
        await act(async () => tree.root.findAllByType('pressable')
            .find((node) => node.props.accessibilityLabel === 'AI 사용량·에이전트 분석').props.onPress());
        await showUsageDetails(tree);
        const content = tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
        assert.ok(content.includes('에이전트·Effort'));
        assert.ok(content.includes('선택한 기간에 Effort·Fast별 상세 기록이 없습니다.'));
    }
});

test('usage dashboard preserves metrics, quota percentages and period refresh controls', async (t) => {
    const { footer, renderScreen } = await loadClient(t, { compact: false });
    const calls = [];
    globalThis.__paseodogTestRpc = async (input, name) => {
        calls.push({ input, name });
        return {
            range: { fromMs: 1, toMs: 2 },
            totals: { costUsd: 14.55, costBilled: 0, costUnpricedTurns: 2, tokens: 1000, turns: 12, cacheHitRate: 0.9,
                input: 50, output: 50, cacheRead: 900, cacheWrite: 0 },
            series: [{ label: '10:00', tokens: 1000 }, { label: '11:00', tokens: 0 }],
            providers: [{ provider: 'openai-oauth', providerKind: 'oauth', label: 'Codex', share: 1, costUsd: 14.55,
                costBilled: 0, cacheHitRate: 0.9, tokens: 1000, turns: 12,
                models: [{ model: 'test-model', tokens: 1000, turns: 12, outputTokensPerSecond: 40,
                    input: 50, output: 50, cacheRead: 900, cacheWrite: 0, cacheHitRate: 0.9, costUsd: 14.55 }] }],
            quotas: [
                { id: 'openai-oauth', label: 'Codex', authenticated: true, updatedAt: 1,
                    windows: [{ label: '7D', usedPct: 68, resetAt: 2 }], resetCredits: { availableCount: 3 } },
                { id: 'anthropic-oauth', label: 'Claude', authenticated: false, updatedAt: null,
                    windows: [], resetCredits: null },
            ],
        };
    };
    const { tree } = await renderScreen(footer);
    const button = (label) => tree.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === label);
    await act(async () => button('AI 사용량·에이전트 분석').props.onPress());
    await showUsageDetails(tree);
    const content = tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
    for (const value of ['90.0%', 'test-model', '68%', '미연결',
        '리셋 티켓 3개 남음', '10:00', '입력']) assert.ok(content.includes(value), value);
    assert.doesNotMatch(content, /환산액|API 비용|\$|가격 미확인|비용 합계/);
    assert.ok(tree.root.findAllByType('view').some((node) => node.props.style?.width === '68%'));
    const period = (label) => tree.root.findAllByType('pressable').find((node) =>
        node.props.accessibilityRole === 'tab' && node.findByType('text').children.join('') === label);
    for (const removed of ['지난 7일', '지난 90일', '지난 1년']) assert.equal(period(removed), undefined);
    assert.equal(period('지난 24시간').props.accessibilityState.selected, true);
    for (const [view, label] of [['1h', '지난 1시간'], ['8h', '지난 8시간']]) {
        await act(async () => period(label).props.onPress());
        assert.deepEqual(calls.at(-1), { input: { view, refresh: 'auto' }, name: 'engine-metrics' });
        assert.equal(period(label).props.accessibilityState.selected, true);
        await act(async () => button('사용량 새로고침').props.onPress());
        assert.deepEqual(calls.at(-1).input, { view, refresh: 'force' });
    }
    await act(async () => period('사용자 지정').props.onPress());
    const field = (label) => tree.root.findAllByType('input').find((node) => node.props.accessibilityLabel === label);
    await act(async () => field('사용량 시작일').props.onChangeText('2026-10-01'));
    await act(async () => field('사용량 종료일').props.onChangeText('2026-10-02'));
    assert.deepEqual(calls.at(-1).input, {
        view: 'custom', startDay: '2026-10-01', endDay: '2026-10-02', refresh: 'auto',
    });
    await act(async () => button('분석 모달 닫기').props.onPress());
});

// 모델·제공자가 달라도 같은 지표 열의 너비와 값 표시를 유지한다.
test('model usage metrics share columns across models and providers without wrapping', async (t) => {
    const { footer, renderScreen } = await loadClient(t, { compact: false });
    globalThis.__paseodogTestRpc = async () => ({
        range: { fromMs: 1, toMs: 2 }, totals: {}, series: [], quotas: [],
        providers: [
            { provider: 'openai-oauth', providerKind: 'oauth', models: [
                { model: 'large', turns: 530, outputTokensPerSecond: 42.9, tokens: 121939203, input: 1104531, output: 300272, cacheRead: 120534400, cacheHitRate: 0.991 },
                { model: 'small', turns: 1, outputTokensPerSecond: 9.6, tokens: 65, input: 55, output: 10, cacheRead: 0, cacheHitRate: 0 },
            ] },
            { provider: 'anthropic-oauth', providerKind: 'oauth', models: [
                { model: 'other', turns: 213, outputTokensPerSecond: 100.8, tokens: 26246642 },
            ] },
        ],
    });
    const { tree } = await renderScreen(footer);
    const trigger = tree.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === 'AI 사용량·에이전트 분석');
    await act(async () => trigger.props.onPress());
    await showUsageDetails(tree);
    const rows = tree.root.findAllByType('view').filter((node) => node.props.accessibilityLabel?.endsWith(' 사용량 지표'));
    assert.equal(rows.length, 3);
    const cells = rows.map((row) => row.findAllByType('text'));
    const header = tree.root.findAllByType('view').find((node) => node.props.accessibilityLabel === 'openai-oauth 모델별 사용량')
        .findAllByType('text').slice(0, 8).map((node) => node.children.join(''));
    assert.deepEqual(header, ['모델', '호출', 'TOK/S', '토큰', '입력', '출력', '캐시', '적중']);
    for (const row of cells) {
        assert.equal(row.length, header.length);
        assert.deepEqual(row.map((cell) => cell.props.style.width), cells[0].map((cell) => cell.props.style.width));
        assert.ok(row.every((cell) => cell.props.style.flexShrink === 0 && cell.props.numberOfLines === 1));
    }
    assert.equal(cells[0][3].children.join(''), '121,939,203');
    assert.equal(cells[1][3].children.join(''), '65');
});

// OAuth 조회 실패를 계정 미연결로 오인하지 않게 하고, 사용자 지정 기간 입력 안내를 표시한다.
test('usage separates OAuth quota failure from disconnected accounts and guides custom dates', async (t) => {
    const { footer, renderScreen } = await loadClient(t);
    const calls = [];
    const quotaError = 'OAuth 할당량을 불러오지 못했어요. 토큰 사용량은 정상 조회됐으며, 새로고침으로 다시 확인할 수 있어요.';
    globalThis.__paseodogTestRpc = async (input) => {
        calls.push(input);
        return { range: { fromMs: 1, toMs: 2 }, totals: { tokens: 4321, turns: 3 }, providers: [], series: [], quotas: [],
            efforts: [{ provider: 'openai', model: 'test', agent: 'worker', effort: 'high', turns: 3, tokens: 4321 }],
            quotaError };
    };
    const { tree } = await renderScreen(footer);
    const pressable = (label) => tree.root.findAllByType('pressable').find((node) =>
        node.props.accessibilityLabel === label || node.findAllByType('text')[0]?.children.join('') === label);
    await act(async () => pressable('AI 사용량·에이전트 분석').props.onPress());
    await showUsageDetails(tree);
    const content = () => tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
    assert.ok(content().includes(quotaError));
    assert.ok(!content().includes('연결된 OAuth 계정 없음'));
    // 할당량 실패와 별개로 토큰·Effort 사용량은 그대로 표시한다.
    assert.ok(content().includes('4,321') && content().includes('worker') && content().includes('high'));
    assert.ok(content().indexOf('OAuth 한도') < content().indexOf(quotaError));
    await act(async () => pressable('사용자 지정').props.onPress());
    assert.equal(calls.length, 1);
    assert.ok(content().includes('YYYY-MM-DD 형식으로 입력하면 조회해요'));
});

// 실행 현황은 단계 중복·원시 모드 이름·ID 없는 조회 실패 행을 사용자 문구로 표시한다.
test('live status hides duplicate job stages, names orchestration modes and marks unavailable rows', async (t) => {
    const { liveScreen, renderScreen } = await loadClient(t);
    globalThis.__paseodogTestRpc = async () => ({ observedAt: 1, sessions: [
        { id: 's1', state: 'running', orchestration: 'swarm', jobs: [
            { id: 'j1', agent: 'worker', status: 'completed', stage: 'completed' },
            { id: 'j2', agent: 'reviewer', status: 'running', stage: 'spawning' }] },
        { state: 'unavailable', jobs: [] },
        { state: 'unavailable', jobs: [] },
    ] });
    const { tree } = await renderScreen(liveScreen);
    const content = tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
    assert.ok(content.includes('완료') && !content.includes('완료 · 완료'));
    assert.ok(content.includes('실행 중 · 에이전트 시작 중'));
    assert.ok(content.includes('모드\n에이전트 협업'));
    assert.equal(content.split('작업 상태 확인 불가').length - 1, 2);
});

// 라벨 기반 버튼 조회·누르기 도우미
function screenHelpers(tree) {
    const labels = () => tree.root.findAllByType('pressable').map((node) => node.findByType('text').children.join(''));
    const press = async (label) => {
        const element = tree.root.findAllByType('pressable').find((node) =>
            node.props.accessibilityLabel === label || node.findAllByType('text').some((text) => text.children.join('') === label));
        assert.ok(element, `button ${label}`);
        await act(async () => element.props.onPress());
    };
    return { tree, press, labels };
}

test('monitor switches to native token and OAuth usage with period selection and refresh', async (t) => {
    const { liveScreen, renderScreen } = await loadClient(t);
    const calls = [];
    globalThis.__paseodogTestRpc = async (input, name) => {
        calls.push([name, input]);
        if (name === 'engine-status') return { sessions: [], observedAt: 123 };
        assert.equal(name, 'engine-metrics');
        return {
            range: { fromMs: 1, toMs: 2 }, totals: { tokens: 100, turns: 2, costUsd: 3, costBilled: 0 },
            providers: [], series: [{ label: '12:00', tokens: 100 }],
            quotas: [{ id: 'openai-oauth', label: 'Codex', authenticated: true, windows: [
                { label: '7D', usedPct: 65, resetAt: 1000 },
            ], resetCredits: { availableCount: 3 } }],
        };
    };
    const screen = await renderScreen(liveScreen);
    await screen.press('사용량·한도');
    assert.deepEqual(calls.at(-1), ['engine-metrics', { view: 'hour', refresh: 'auto' }]);
    assert.match(JSON.stringify(screen.tree.toJSON()), /Codex|65%|리셋 티켓/);
    assert.doesNotMatch(JSON.stringify(screen.tree.toJSON()), /지난 7일|지난 90일|지난 1년/);
    for (const [view, label] of [['1h', '지난 1시간'], ['8h', '지난 8시간']]) {
        await screen.press(label);
        assert.deepEqual(calls.at(-1), ['engine-metrics', { view, refresh: 'auto' }]);
        await screen.press('사용량 새로고침');
        assert.deepEqual(calls.at(-1), ['engine-metrics', { view, refresh: 'force' }]);
    }
});

// 세션 선택·모델 전환·계승 확인을 실제 공유 화면에서 검증한다.
test('session tools scope model changes and require confirmation before inheritance', async (t) => {
    const { panels, renderScreen } = await loadClient(t);
    const calls = [];
    globalThis.__paseodogTestRpc = async (input, name) => {
        calls.push({ name, input });
        if (name === 'engine-status') return { sessions: [
            { id: 'session-one', title: 'Project', state: 'idle', provider: 'first', model: 'one' },
        ] };
        if (name === 'engine-controls') return { models: [{ id: 'two', label: 'Two', provider: 'second' }] };
        if (name === 'engine-resources') return { mcp: [] };
        if (input.operation === 'fork') return { persistence: { version: 2, data: { bridgeId: 'heir' } } };
        return { config: { model: 'second/two' } };
    };
    const screen = await renderScreen(panels.find((item) => item.id === 'mixdog-session-tools'));
    await screen.press('Project · one');
    await screen.press('Two · second');
    assert.deepEqual(calls.find((call) => call.name === 'engine-session').input, {
        sessionId: 'session-one', operation: 'configure', changes: { model: 'second/two' },
    });
    await screen.press('현재 대화를 새 세션으로 계승');
    assert.equal(calls.filter((call) => call.input.operation === 'fork').length, 0);
    await screen.press('확인하고 실행');
    assert.deepEqual(calls.find((call) => call.input.operation === 'fork').input, {
        sessionId: 'session-one', operation: 'fork', confirmed: true,
    });
    assert.match(JSON.stringify(screen.tree.toJSON()), /원본은 유지/);
});

// 네이티브 파일·턴 상태에 따라 복구 가능한 버튼만 활성화한다.
test('session undo and redo buttons reflect native recovery availability', async (t) => {
    const { panels, renderScreen } = await loadClient(t);
    globalThis.__paseodogTestRpc = async (input, name) => {
        if (name === 'engine-status') return { sessions: [{ id: 'one', title: 'Project', model: 'model', state: 'idle' }] };
        if (name === 'engine-controls') return { models: [] };
        if (name === 'engine-resources') return { mcp: [] };
        if (input.operation === 'history') return { turns: [{ checkpointId: 'cp', files: 3 }] };
        return { status: 'ready', canUndo: false, canReapply: true, revision: 4, reason: 'blocked file',
            files: [
                { path: 'applied', state: 'applied', revertable: true },
                { path: 'reverted', state: 'reverted', revertable: true },
                { path: 'blocked', state: 'applied', revertable: false, reason: 'missing patch' },
            ] };
    };
    const screen = await renderScreen(panels.find((item) => item.id === 'mixdog-session-tools'));
    await screen.press('Project · model');
    await screen.press('턴별 변경 이력');
    await screen.press('최근 1번째 턴 · 3개 파일');
    for (const [label, disabled] of [
        ['Undo · applied', false], ['Redo · applied', true],
        ['Undo · reverted', true], ['Redo · reverted', false],
        ['Undo · blocked', true], ['Redo · blocked', true],
        ['선택한 턴 전체 Undo', true], ['선택한 턴 전체 Redo', false],
    ]) {
        const button = screen.tree.root.findAllByType('pressable')
            .find((node) => node.findByType('text').children.join('') === label);
        assert.equal(button.props.disabled, disabled, label);
    }
    assert.match(JSON.stringify(screen.tree.toJSON()), /missing patch/);
});

test('native config viewer selects Claude/Codex sources, refreshes read-only and labels it as not applied', async (t) => {
    const { screens, renderScreen } = await loadClient(t);
    const calls = [];
    // 출처별 응답 생성 (조회 입력 -> 원본 보기 결과)
    const view = (source) => ({
        source, label: source, notice: '원본 설정 보기 전용입니다. PaseoDog 세션에는 적용되지 않으며',
        configRoot: `~/.${source}`, observedAt: 1,
        skills: { truncated: false, roots: [{ path: `~/.${source}/skills`, scope: 'user', label: '사용자', status: 'ok', count: 1 }],
            items: [{ name: `${source}-skill`, folder: 'x', description: `${source} 설명`, body: `# ${source} 본문`,
                bodyTruncated: false, path: `~/.${source}/skills/x/SKILL.md`, scope: 'user', scopeLabel: '사용자',
                aliases: [], issues: [], enabled: source === 'claude', state: source === 'claude' ? '켜짐' : '꺼짐 (skills.config)' }] },
        hooks: { supported: true, truncated: false, globalState: `${source} 훅 상태`,
            sources: [{ path: `~/.${source}/hooks.json`, scope: 'user', label: 'hooks', status: 'malformed', error: 'JSON 형식 오류 (2행)' }],
            rules: [{ event: 'PreToolUse', matcher: 'Bash', type: 'command', command: `${source}-hook --token ***`,
                source: `~/.${source}/hooks.json`, scope: 'user', position: '0:0', enabled: true, state: '켜짐' }] },
        notes: [`${source} 제한 사항`],
    });
    globalThis.__paseodogTestRpc = async (input, name) => {
        calls.push({ input, name });
        return view(input.source);
    };
    const { tree } = await renderScreen(screens.find((item) => item.id === 'paseodog-native-config'));
    const content = () => tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
    const pressable = (label) => tree.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === label);
    assert.deepEqual(calls, [{ input: { source: 'claude' }, name: 'native-config-view' }]);
    assert.match(content(), /원본 설정 보기 전용 · PaseoDog에 적용되지 않음/);
    for (const value of ['claude-skill', 'claude 설명', '~/.claude/skills/x/SKILL.md', 'PreToolUse · Bash · 켜짐',
        'claude-hook --token ***', 'JSON 형식 오류 (2행)', 'claude 제한 사항']) assert.ok(content().includes(value), value);
    assert.ok(!content().includes('# claude 본문'));
    await act(async () => pressable('스킬 claude-skill 본문 보기').props.onPress());
    assert.ok(content().includes('# claude 본문'));

    await act(async () => pressable('Codex 원본 설정').props.onPress());
    assert.deepEqual(calls.at(-1), { input: { source: 'codex' }, name: 'native-config-view' });
    assert.equal(pressable('Codex 원본 설정').props.accessibilityState.selected, true);
    assert.ok(content().includes('codex-skill · 꺼짐') && !content().includes('claude-skill'));
    await act(async () => pressable('원본 설정 새로고침').props.onPress());
    assert.deepEqual(calls.at(-1), { input: { source: 'codex' }, name: 'native-config-view' });
    // 이미 읽은 출처로 돌아갈 때는 재조회하지 않고, 모든 호출은 출처만 담은 읽기 요청이다.
    await act(async () => pressable('Claude Code 원본 설정').props.onPress());
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.name === 'native-config-view' && Object.keys(call.input).join() === 'source'));
    assert.equal(tree.root.findAllByType('input').length, 0);
});

// 휴대폰 레이아웃은 Codex·Claude 탭으로 요약·한도·상세 표를 제공자별로 나눠 보여준다.
test('compact usage switches Codex and Claude with provider tabs', async (t) => {
    const { footer, renderScreen } = await loadClient(t);
    globalThis.__paseodogTestRpc = async () => ({
        range: { fromMs: 1, toMs: 2 }, totals: { tokens: 300, turns: 3 }, series: [],
        providers: [
            { provider: 'anthropic-oauth', providerKind: 'oauth', label: 'Claude', tokens: 200, turns: 1, outputTokensPerSecond: 61.5,
                low10OutputTokensPerSecond: 21.2, high10OutputTokensPerSecond: 91.8,
                models: [{ model: 'claude-model', tokens: 200, turns: 1 }] },
            { provider: 'openai-oauth', providerKind: 'oauth', label: 'Codex', tokens: 100, turns: 2, outputTokensPerSecond: 12.5,
                low10OutputTokensPerSecond: 8.3, high10OutputTokensPerSecond: 18.6,
                models: [{ model: 'codex-model', tokens: 100, turns: 2 }] },
        ],
        quotas: [
            { id: 'openai-oauth', label: 'Codex', authenticated: true, updatedAt: 1, windows: [{ label: '7D', usedPct: 41, resetAt: 2 }], resetCredits: null },
            { id: 'anthropic-oauth', label: 'Claude', authenticated: true, updatedAt: 1, windows: [{ label: '5H', usedPct: 77, resetAt: 2 }], resetCredits: null },
        ],
        efforts: [{ provider: 'anthropic-oauth', model: 'claude-model', agent: 'worker', effort: 'low', turns: 1, tokens: 200 }],
    });
    const { tree } = await renderScreen(footer);
    const button = (label) => tree.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === label);
    const content = () => tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
    await act(async () => button('AI 사용량·에이전트 분석').props.onPress());
    // Codex가 먼저 선택되고 Claude 지표는 숨긴다.
    assert.equal(button('Codex 사용량').props.accessibilityState.selected, true);
    assert.ok(content().includes('12.5 tok/s') && content().includes('41%'));
    assert.ok(content().includes('하위 10% 평균 속도') && content().includes('상위 10% 평균 속도'));
    assert.ok(content().includes('8.3 tok/s') && content().includes('18.6 tok/s'));
    assert.ok(!content().includes('21.2 tok/s') && !content().includes('91.8 tok/s'));
    assert.ok(!content().includes('61.5 tok/s') && !content().includes('77%'));
    await act(async () => button('Claude 사용량').props.onPress());
    assert.ok(content().includes('61.5 tok/s') && content().includes('77%') && !content().includes('12.5 tok/s'));
    assert.ok(content().includes('21.2 tok/s') && content().includes('91.8 tok/s'));
    assert.ok(!content().includes('8.3 tok/s') && !content().includes('18.6 tok/s'));
    await showUsageDetails(tree);
    assert.ok(content().includes('claude-model') && !content().includes('codex-model'));
    assert.ok(content().includes('모든 제공자 합계'));
});

test('wide usage summary compares providers in aligned rows without cost metrics', async (t) => {
    const { footer, renderScreen } = await loadClient(t, { compact: false });
    globalThis.__paseodogTestRpc = async () => ({
        range: { fromMs: 1, toMs: 2 }, totals: { costUsd: 265.45, costBilled: 9, costUnpricedTurns: 1 },
        series: [], quotas: [],
        providers: [
            { provider: 'openai-oauth', label: 'Codex', tokens: 176862097, turns: 1772,
                outputTokensPerSecond: 26.7, low10OutputTokensPerSecond: 8, high10OutputTokensPerSecond: 50.4,
                cacheHitRate: 0.968, costUsd: 223.86, costBilled: 9, models: [] },
            { provider: 'anthropic-oauth', label: 'Claude', tokens: 90299833, turns: 427,
                outputTokensPerSecond: 112, low10OutputTokensPerSecond: 69.2, high10OutputTokensPerSecond: 139.5,
                cacheHitRate: 0.976, costUsd: 41.59, costBilled: 0, models: [] },
        ],
    });
    const { tree, press } = await renderScreen(footer);
    await press('AI 사용량·에이전트 분석');
    const summary = tree.root.findAllByType('view').find((node) => node.props.accessibilityLabel === '제공자별 사용량 요약');
    const rows = summary.findAllByType('view').filter((node) => ['Codex 요약', 'Claude 요약'].includes(node.props.accessibilityLabel));
    const cells = rows.map((row) => row.findAllByType('text'));
    assert.deepEqual(cells.map((row) => row.map((cell) => cell.children.join(''))), [
        ['Codex', '26.7 tok/s', '8.0 tok/s', '50.4 tok/s', '176,862,097', '1,772', '96.8%'],
        ['Claude', '112.0 tok/s', '69.2 tok/s', '139.5 tok/s', '90,299,833', '427', '97.6%'],
    ]);
    assert.deepEqual(cells[0].map((cell) => cell.props.style.width), cells[1].map((cell) => cell.props.style.width));
    assert.ok(cells.flat().every((cell) => cell.props.numberOfLines === 1));
    for (const mode of ['사용량 요약', '사용량 자세히']) {
        await press(mode);
        const content = tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
        assert.doesNotMatch(content, /환산액|API 비용|\$|가격 미확인|비용 합계/);
    }
});

for (const compact of [false, true]) {
    test(`usage remembers selections after closing and remounting (${compact ? 'compact' : 'wide'})`, async (t) => {
        const { footer, renderScreen } = await loadClient(t, { compact });
        const calls = [];
        globalThis.__paseodogTestRpc = async (input, name) => {
            calls.push({ input, name });
            if (name === 'engine-status') return { sessions: [] };
            return { range: { fromMs: 1, toMs: 2 }, totals: {}, series: [], quotas: [], providers: [
                { provider: 'openai-oauth', label: 'Codex', models: [] },
                { provider: 'anthropic-oauth', label: 'Claude', models: [] },
            ] };
        };
        let screen = await renderScreen(footer);
        const button = (label) => screen.tree.root.findAllByType('pressable').find((node) =>
            node.props.accessibilityLabel === label || node.findAllByType('text').some((text) => text.children.join('') === label));
        const field = (label) => screen.tree.root.findAllByType('input').find((node) => node.props.accessibilityLabel === label);
        await screen.press('AI 사용량·에이전트 분석');
        await screen.press('지난 8시간');
        await screen.press('사용량 자세히');
        if (compact) await screen.press('Claude 사용량');
        await screen.press('사용량 새로고침');
        assert.deepEqual(calls.at(-1).input, { view: '8h', refresh: 'force' });
        await screen.press('분석 모달 닫기');
        const closedCalls = calls.length;
        assert.equal(screen.tree.root.findAllByType('scroll').length, 0);
        await screen.press('AI 사용량·에이전트 분석');
        assert.equal(calls.length, closedCalls + 1);
        assert.deepEqual(calls.at(-1), { input: { view: '8h', refresh: 'auto' }, name: 'engine-metrics' });
        assert.equal(button('지난 8시간').props.accessibilityState.selected, true);
        assert.equal(button('사용량 자세히').props.accessibilityState.selected, true);
        if (compact) assert.equal(button('Claude 사용량').props.accessibilityState.selected, true);
        await screen.press('에이전트 실행');
        await screen.press('사용량·한도');
        assert.deepEqual(calls.at(-1).input, { view: '8h', refresh: 'auto' });
        assert.equal(button('사용량 자세히').props.accessibilityState.selected, true);
        if (compact) assert.equal(button('Claude 사용량').props.accessibilityState.selected, true);
        await screen.press('사용자 지정');
        await act(async () => field('사용량 시작일').props.onChangeText('2026-10-01'));
        const incompleteCalls = calls.length;
        await screen.press('분석 모달 바깥 닫기');
        await screen.press('AI 사용량·에이전트 분석');
        assert.equal(calls.length, incompleteCalls);
        assert.equal(field('사용량 시작일').props.value, '2026-10-01');
        assert.equal(field('사용량 종료일').props.value, '');
        await act(async () => field('사용량 종료일').props.onChangeText('2026-10-02'));
        await act(async () => screen.tree.unmount());
        screen = await renderScreen(footer);
        await screen.press('AI 사용량·에이전트 분석');
        assert.deepEqual(calls.at(-1), { name: 'engine-metrics',
            input: { view: 'custom', startDay: '2026-10-01', endDay: '2026-10-02', refresh: 'auto' } });
        assert.equal(button('사용자 지정').props.accessibilityState.selected, true);
        assert.equal(button('사용량 자세히').props.accessibilityState.selected, true);
        assert.equal(field('사용량 시작일').props.value, '2026-10-01');
        assert.equal(field('사용량 종료일').props.value, '2026-10-02');
        if (compact) {
            assert.equal(button('Claude 사용량').props.accessibilityState.selected, true);
            const summary = screen.tree.root.findAllByType('view').find((node) => node.props.accessibilityLabel === 'Claude 요약');
            assert.equal(summary.findAllByType('text').length, 14);
        }
    });
}

// 분석 모달은 다른 모달처럼 바깥 영역을 누르면 닫힌다.
test('analysis modal closes when the backdrop is pressed', async (t) => {
    const { footer, renderScreen } = await loadClient(t);
    globalThis.__paseodogTestRpc = async () => ({ range: { fromMs: 1, toMs: 2 }, totals: {}, series: [], providers: [], quotas: [] });
    const { tree } = await renderScreen(footer);
    const button = (label) => tree.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === label);
    await act(async () => button('AI 사용량·에이전트 분석').props.onPress());
    assert.equal(tree.root.findByType('modal').props.visible, true);
    await act(async () => button('분석 모달 바깥 닫기').props.onPress());
    assert.equal(tree.root.findByType('modal').props.visible, false);
});
