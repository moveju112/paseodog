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
async function loadClient(t) {
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
    const settings = (id) => {
        const found = settingsScreens.find((item) => item.id === id);
        assert.ok(found, `settings screen ${id}`);
        return found;
    };
    // 설정 화면 렌더링과 라벨 기반 버튼 누르기 도우미
    const renderScreen = async (screen) => {
        let tree;
        await act(async () => {
            tree = create(React.createElement(screen.Component, {
                theme: { colors: { foreground: '#ffffff' } }, host: { id: 'test', label: 'test' },
                layout: { compact: true, platform: 'android' },
            }));
        });
        mounted.push(tree);
        return screenHelpers(tree);
    };
    return { settingsScreens, settings, screens, panels, liveScreen, footer, renderScreen };
}

test('workflow message switch persists independently and never retries an uncertain save', async (t) => {
    const { settings, renderScreen } = await loadClient(t);
    const requests = [];
    let allow = true, rejectWrite = false, finishWrite;
    globalThis.__paseodogTestRpc = async (input, name) => {
        if (name === 'engine-controls') return {
            route: {}, models: [], compaction: {}, workflows: [], agents: [], sessions: [], orchestration: 'swarm',
        };
        assert.equal(name, 'agent-message-policy');
        requests.push(input);
        if (input.action === 'write') {
            if (rejectWrite) throw new Error('uncertain');
            await new Promise(resolve => { finishWrite = resolve; });
            allow = input.allowUnrelatedSessions;
        }
        return { allowUnrelatedSessions: allow };
    };
    const screen = await renderScreen(settings('mixdog-workflow'));
    const toggle = () => screen.tree.root.findByProps({ accessibilityLabel: '무관한 세션 간 메시지 허용' });
    assert.equal(toggle().props.accessibilityState.checked, true);
    await act(async () => {
        toggle().props.onPress();
        toggle().props.onPress();
    });
    assert.equal(toggle().props.disabled, true);
    assert.equal(requests.filter(input => input.action === 'write').length, 1);
    await act(async () => finishWrite());
    assert.equal(toggle().props.accessibilityState.checked, false);
    assert.ok(screen.labels().includes('✓ 에이전트 협업'));
    rejectWrite = true;
    await act(async () => toggle().props.onPress());
    assert.equal(toggle().props.disabled, true);
    assert.match(JSON.stringify(screen.tree.toJSON()), /자동 재시도하지/);
    assert.equal(requests.filter(input => input.action === 'write').length, 2);
    await screen.press('세션 메시지 설정 새로고침');
    assert.equal(toggle().props.disabled, false);
    assert.equal(toggle().props.accessibilityState.checked, false);
    assert.equal(requests.filter(input => input.action === 'write').length, 2);
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
    const labels = tree.root.findAllByType('view').map((node) => node.props.accessibilityLabel);
    assert.ok(labels.includes('worker openai test low 사용량'));
    assert.ok(labels.includes('에이전트 미기록 openai test effort 미기록 사용량'));
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
    const { footer, renderScreen } = await loadClient(t);
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
    const views = tree.root.findAllByType('view');
    const groups = views.filter((node) => node.props.accessibilityLabel?.endsWith(' 에이전트 사용량'));
    assert.deepEqual(groups.map((node) => node.props.accessibilityLabel),
        ['worker 에이전트 사용량', 'reviewer 에이전트 사용량', '에이전트 미기록 에이전트 사용량']);
    const texts = (node) => node.findAllByType('text').map((item) => item.children.join(''));
    // 표 행: 모델 이름은 같은 모델의 첫 effort 행에만 쓰고 나머지 행은 비운다.
    const rows = (group) => group.findAllByType('view').filter((node) => node.props.accessibilityLabel?.endsWith(' 사용량')
        && !node.props.accessibilityLabel.endsWith(' 에이전트 사용량'));
    assert.deepEqual(rows(groups[0]).map((row) => texts(row)), [
        ['openai · gpt', 'low', '1', '10', '$0.10'],
        ['', 'high', '2', '20', '$0.20'],
        ['azure · gpt', 'low', '3', '30', '$0.30'],
        ['openai · mini', '미기록', '5', '50', '미확인'],
    ]);
    assert.deepEqual(rows(groups[1]).map((row) => texts(row)), [['openai · gpt', 'high', '4', '40', '$0.40']]);
    assert.deepEqual(rows(groups[2]).map((row) => texts(row)), [['openai · gpt', '미기록', '6', '60', '$0.60']]);
    assert.deepEqual(rows(groups[0]).map((row) => row.props.accessibilityLabel).slice(0, 2),
        ['worker openai gpt low 사용량', 'worker openai gpt high 사용량']);
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
        const content = tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
        assert.ok(content.includes('에이전트·Effort'));
        assert.ok(content.includes('선택한 기간에 Effort별 상세 기록이 없습니다.'));
    }
});

test('usage dashboard preserves metrics, quota percentages and period refresh controls', async (t) => {
    const { footer, renderScreen } = await loadClient(t);
    const calls = [];
    globalThis.__paseodogTestRpc = async (input, name) => {
        calls.push({ input, name });
        return {
            range: { fromMs: 1, toMs: 2 },
            totals: { costUsd: 14.55, costBilled: 0, tokens: 1000, turns: 12, cacheHitRate: 0.9,
                input: 50, output: 50, cacheRead: 900, cacheWrite: 0 },
            series: [{ label: '10:00', tokens: 1000 }, { label: '11:00', tokens: 0 }],
            providers: [{ provider: 'openai-oauth', providerKind: 'oauth', share: 1, costUsd: 14.55,
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
    const content = tree.root.findAllByType('text').map((node) => node.children.join('')).join('\n');
    for (const value of ['환산액', '$14.55', '$0.00', '90.0%', 'test-model', '68%', '미연결',
        '리셋 티켓 3개 남음', '10:00', '입력']) assert.ok(content.includes(value), value);
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
    const { footer, renderScreen } = await loadClient(t);
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
    const rows = tree.root.findAllByType('view').filter((node) => node.props.accessibilityLabel?.endsWith(' 사용량 지표'));
    assert.equal(rows.length, 3);
    const cells = rows.map((row) => row.findAllByType('text'));
    const header = tree.root.findAllByType('view').find((node) => node.props.accessibilityLabel === 'openai-oauth 모델별 사용량')
        .findAllByType('text').slice(0, 9).map((node) => node.children.join(''));
    assert.deepEqual(header, ['모델', '호출', 'TOK/S', '토큰', '입력', '출력', '캐시', '적중', '환산액']);
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

// 저장 응답 전에는 컨트롤을 잠그고, 실패하면 낙관적 표시를 되돌리고 오류를 남긴다.
test('settings lock controls while a save is pending and keep its failure visible', async (t) => {
    const { settings, renderScreen } = await loadClient(t);
    const snapshot = { route: { provider: 'p', model: 'm', autoEffort: false, fast: false }, models: [],
        compaction: { auto: true }, workflows: [], orchestration: 'swarm', agents: [], sessions: [] };
    let rejectSave;
    globalThis.__paseodogTestRpc = async (input) => input.action === 'read' ? snapshot
        : new Promise((resolve, reject) => { rejectSave = reject; });
    const tokens = await renderScreen(settings('mixdog-tokens'));
    const find = (pattern) => tokens.tree.root.findAllByType('pressable')
        .find((node) => pattern.test(node.findByType('text').children.join('')));
    await tokens.press('자동 압축: 켜짐');
    assert.equal(find(/^자동 압축: 꺼짐$/).props.disabled, true);
    assert.equal(find(/유휴 컨텍스트 자동 정리/).props.disabled, true);
    await act(async () => rejectSave(new Error('저장 실패: 엔진 응답 없음')));
    assert.equal(find(/^자동 압축: 켜짐$/).props.disabled, false);
    assert.match(JSON.stringify(tokens.tree.toJSON()), /저장 실패: 엔진 응답 없음/);
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
            node.props.accessibilityLabel === label || node.findByType('text').children.join('') === label);
        assert.ok(element, `button ${label}`);
        await act(async () => element.props.onPress());
    };
    return { tree, press, labels };
}

test('token settings require a Main model before saving a context limit', async (t) => {
    const { settings, renderScreen } = await loadClient(t);
    const calls = [];
    let route = { provider: 'subscription', model: '', fast: false, autoEffort: true };
    globalThis.__paseodogTestRpc = async (input) => {
        calls.push(input);
        return { route, models: [], compaction: { auto: true }, workflows: [], agents: [], sessions: [], orchestration: 'none' };
    };
    const screen = await renderScreen(settings('mixdog-tokens'));
    const limits = () => screen.tree.root.findAllByType('pressable')
        .filter((node) => node.findByType('text').children.join('').includes('컨텍스트 한도'));
    assert.equal(limits().length, 4);
    assert.ok(limits().every((node) => node.props.disabled && !node.props.accessibilityState.selected));
    assert.match(JSON.stringify(screen.tree.toJSON()), /새 대화 입력창에서 Main 모델을 먼저 선택해 주세요/);
    assert.deepEqual(calls, [{ action: 'read' }]);
    await screen.press('자동 압축: 켜짐');
    assert.deepEqual(calls.at(-1), { action: 'compaction', enabled: false });
    route = { ...route, model: 'small' };
    await screen.press('새로고침');
    assert.ok(limits().every((node) => !node.props.disabled));
    await screen.press('컨텍스트 한도 50%');
    assert.deepEqual(calls.at(-1), { action: 'main', route: { contextPercent: 50 } });
});

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

// 확장 설치 입력과 오류 후 비재전송을 공유 네이티브·web 화면에서 확인한다.
test('MCP editor confirms exact native input and never retries an uncertain mutation', async (t) => {
    const { settings, renderScreen } = await loadClient(t);
    const calls = [];
    globalThis.__paseodogTestRpc = async (input, name) => {
        assert.equal(name, 'engine-resources');
        calls.push(input);
        if (input.operation === 'mcpAdd') throw new Error('timeout');
        return { mcp: [], skills: [], plugins: [] };
    };
    const screen = await renderScreen(settings('mixdog-resources'));
    for (const [label, value] of [['MCP 이름', 'tools'], ['MCP 명령', 'tool'], ['MCP 인자', 'one\ntwo']]) {
        await act(async () => screen.tree.root.findAllByType('input')
            .find((node) => node.props.accessibilityLabel === label).props.onChangeText(value));
    }
    await screen.press('MCP 추가');
    assert.equal(calls.filter((call) => call.operation === 'mcpAdd').length, 0);
    await screen.press('확인하고 실행');
    assert.deepEqual(calls.filter((call) => call.operation === 'mcpAdd'), [{
        operation: 'mcpAdd', confirmed: true, data: { name: 'tools', type: 'stdio', command: 'tool', args: ['one', 'two'] },
    }]);
    assert.match(JSON.stringify(screen.tree.toJSON()), /자동 재시도하지 않습니다/);
});

// 스킬 선택 시 본문을 교체하고 읽기 실패 후에는 빈 본문으로 덮어쓰지 못하게 한다.
test('skill selection loads the selected body and read failures disable saving', async (t) => {
    const { settings, renderScreen } = await loadClient(t);
    const calls = [];
    globalThis.__paseodogTestRpc = async (input) => {
        calls.push(input);
        if (input.operation === 'skillRead') {
            if (input.name === 'broken') throw new Error('read failed');
            return { name: input.name, content: `body ${input.name}` };
        }
        return { skills: ['a', 'b', 'broken'].map((name) => ({ name })), mcp: [], plugins: [] };
    };
    const screen = await renderScreen(settings('mixdog-resources'));
    await screen.press('skills');
    await screen.press('a 내용 보기');
    const body = () => screen.tree.root.findAllByType('input')
        .find((node) => node.props.accessibilityLabel === '스킬 지침 본문');
    await act(async () => body().props.onChangeText('edited a'));
    await screen.press('b 내용 보기');
    assert.equal(body().props.value, 'body b');
    await screen.press('스킬 수정');
    await screen.press('확인하고 실행');
    assert.deepEqual(calls.find((input) => input.operation === 'skillSave').data,
        { name: 'b', originalName: 'b', description: '', body: 'body b' });
    await screen.press('broken 내용 보기');
    assert.equal(body().props.value, '');
    const save = screen.tree.root.findAllByType('pressable')
        .find((node) => node.findByType('text').children.join('') === '스킬 수정');
    assert.equal(save.props.disabled, true);
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

test('settings register separate sections without a main model picker and dispatch scoped changes', async (t) => {
    const { settingsScreens, settings, screens, panels, liveScreen, renderScreen } = await loadClient(t);
    assert.deepEqual(settingsScreens.map((item) => [item.id, item.title, item.icon]), [
        ['mixdog-resources', 'MCP·스킬·플러그인', 'Bot'],
        ['mixdog-account', '구독 계정', 'Bot'], ['mixdog-workflow', '워크플로', 'Bot'],
        ['mixdog-tokens', '토큰 절감', 'Bot'], ['mixdog-instructions', '지침 파일 로딩', 'Bot'],
        ['mixdog-agents', '에이전트', 'Bot'],
    ]);
    for (const item of settingsScreens) assert.deepEqual(Object.keys(item).sort(), ['Component', 'icon', 'id', 'title']);
    assert.equal(panels.find((item) => item.id === 'mixdog-live').Component, liveScreen.Component);
    assert.ok(panels.some((item) => item.id === 'mixdog-session-tools'));
    assert.ok(screens.some((item) => item.id === 'paseodog-native-config'));
    const calls = [];
    const snapshot = {
        route: { provider: 'subscription', model: 'small', effort: 'low', fast: false, autoEffort: false },
        models: [{ provider: 'subscription', id: 'small', label: 'Small', fastCapable: true,
            effortOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }],
        compaction: { auto: true }, workflows: [{ id: 'default', name: 'Default', active: true }],
        orchestration: 'swarm', instructionFiles: 'all', agents: [{ id: 'worker', label: 'Worker', disabled: false,
            route: { provider: 'subscription', model: 'small', effort: 'low', autoEffort: false, fast: false } }],
        sessions: [{ id: 's1', running: true, model: 'small', compaction: { auto: true },
            context: { usedTokens: 42 }, jobs: [{ id: 'j1', agent: 'worker', status: 'running' }] }],
    };
    const definition = { id: 'worker', name: 'Worker', description: '검증 담당',
        body: '# Worker\n\n  keep   original\tspacing\n', custom: false, userOverride: true };
    let reply = (input) => input.action === 'agentDefinition' ? { ...snapshot, agentDefinition: definition }
        : input.action === 'workflowPack' ? { ...snapshot, workflowPack: { id: 'default', name: 'Default', body: '# Flow' } }
            : input.action === 'preferences' && input.profile ? { ...snapshot, profile: input.profile } : snapshot;
    globalThis.__paseodogTestRpc = async (input, name) => {
        if (name === 'agent-message-policy') return { allowUnrelatedSessions: true };
        assert.equal(name, 'engine-controls');
        calls.push(input);
        return reply(input);
    };
    const mainPicker = /^(✓ )?(Main|모델 선택|에이전트 모델 선택|추론: .*|Fast: .*|Small · subscription)$/;

    // 워크플로: 오케스트레이션·워크플로 보기/편집/생성만 표시한다.
    const workflow = await renderScreen(settings('mixdog-workflow'));
    assert.deepEqual(calls.at(-1), { action: 'read' });
    assert.ok(workflow.labels().includes('✓ 에이전트 협업'));
    assert.ok(workflow.labels().includes('단독 실행'));
    assert.ok(!workflow.labels().some((label) => /focused|balanced|^swarm$|^none$/.test(label)));
    assert.ok(!workflow.labels().some((label) => mainPicker.test(label) || /자동 압축|Worker|지침 파일|구독 계정/.test(label)));
    assert.doesNotMatch(JSON.stringify(workflow.tree.toJSON()), /usedTokens|s1/);
    assert.equal(workflow.tree.root.findAllByType('modal').length, 0);
    await workflow.press('✓ 에이전트 협업');
    assert.deepEqual(calls.at(-1), { action: 'orchestration', mode: 'swarm' });
    await workflow.press('전문가');
    assert.deepEqual(calls.at(-1), { action: 'preferences', profile: { experienceLevel: 'expert' } });
    await workflow.press('자동');
    assert.deepEqual(calls.at(-1), { action: 'preferences', profile: { experienceLevel: '' } });
    await workflow.press('✓ Default');
    assert.deepEqual(calls.at(-1), { action: 'workflow', workflow: 'default' });
    await workflow.press('현재 워크플로(Default) 내용 보기·편집');
    assert.deepEqual(calls.at(-1), { action: 'workflowPack', workflow: 'default' });
    const body = workflow.tree.root.findAll((node) => node.type === 'input' && node.props.accessibilityLabel === '워크플로 본문');
    assert.equal(body[0].props.value, '# Flow');
    await act(async () => body[0].props.onChangeText('# Flow 2'));
    await workflow.press('워크플로 저장 및 즉시 적용');
    assert.deepEqual(calls.at(-1), { action: 'workflowSave', workflow: 'default', body: '# Flow 2', activate: true });
    await workflow.press('새 커스텀 워크플로 추가');
    const field = (label) => workflow.tree.root.find((node) => node.type === 'input' && node.props.accessibilityLabel === label);
    await act(async () => field('새 워크플로 이름').props.onChangeText(' Fast TDD '));
    await act(async () => field('새 워크플로 설명').props.onChangeText('빠른 검증'));
    await workflow.press('새 워크플로 생성');
    assert.deepEqual(calls.at(-1), { action: 'workflowCreate', name: 'Fast TDD', description: '빠른 검증', activate: true });

    // 토큰 절감: Main 모델·추론 선택 없이 토큰 관련 토글과 Main Fast만 표시한다.
    const tokens = await renderScreen(settings('mixdog-tokens'));
    assert.ok(!tokens.labels().some((label) => mainPicker.test(label) || /balanced|Worker|지침 파일/.test(label)));
    assert.equal(tokens.tree.root.findAllByType('input').length, 0);
    // 자동 추론은 입력창 Effort 목록으로 옮겨 설정 화면에 중복 스위치를 두지 않는다.
    assert.ok(!tokens.labels().some((label) => /자동 추론 조절/.test(label)));
    await tokens.press('Fast 응답: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'main', route: { fast: true } });
    await tokens.press('자동 압축: 켜짐');
    assert.deepEqual(calls.at(-1), { action: 'compaction', enabled: false });
    await tokens.press('모델 변경 시 자동 압축: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'compaction', onModelChange: true });
    await tokens.press('컨텍스트 버퍼 25%');
    assert.deepEqual(calls.at(-1), { action: 'compaction', mainBufferPercent: 0.25 });
    assert.ok(!tokens.labels().includes('컨텍스트 버퍼 30%'));
    await tokens.press('유휴 컨텍스트 자동 정리: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'autoClear', enabled: true });

    // 지침 파일 로딩: 읽기만으로는 선택형 모드를 바꾸지 않고, 클릭 시에만 all <-> off 를 보낸다.
    snapshot.instructionFiles = 'agents';
    const instructions = await renderScreen(settings('mixdog-instructions'));
    assert.deepEqual(calls.at(-1), { action: 'read' });
    assert.ok(!instructions.labels().some((label) => mainPicker.test(label) || /balanced|자동 압축|Worker/.test(label)));
    assert.match(JSON.stringify(instructions.tree.toJSON()), /~\/\.codex\/AGENTS\.md/);
    assert.match(JSON.stringify(instructions.tree.toJSON()), /새 세션부터/);
    assert.match(JSON.stringify(instructions.tree.toJSON()), /agents/);
    reply = (input) => input.action === 'instructionFiles' ? { ...snapshot, instructionFiles: input.enabled ? 'all' : 'off' } : snapshot;
    await instructions.press('✓ 지침 파일 로딩: 켜짐');
    assert.deepEqual(calls.at(-1), { action: 'instructionFiles', enabled: false });
    await instructions.press('지침 파일 로딩: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'instructionFiles', enabled: true });
    assert.ok(instructions.labels().includes('✓ 지침 파일 로딩: 켜짐'));
    assert.ok(!calls.filter((input) => input.action === 'instructionFiles')
        .some((input) => 'language' in input || 'profile' in input));

    // 에이전트: Main 선택 없이 에이전트 전용 모델·추론·Fast와 원본 정의를 표시한다.
    reply = (input) => input.action === 'agentDefinition' ? { ...snapshot, agentDefinition: definition } : snapshot;
    const agents = await renderScreen(settings('mixdog-agents'));
    assert.ok(!agents.labels().some((label) => /^(✓ )?Main$|^(✓ )?모델 선택$|balanced|자동 압축|지침 파일/.test(label)));
    await agents.press('Worker · 켜짐');
    await agents.press('에이전트 끄기');
    assert.deepEqual(calls.at(-1), { action: 'agent', agent: 'worker', route: { disabled: true } });
    await agents.press('에이전트 모델 선택');
    assert.equal(agents.tree.root.findAll((node) => node.type === 'input' && node.props.accessibilityLabel === '모델 검색').length, 1);
    await agents.press('✓ Small · subscription');
    assert.deepEqual(calls.at(-1), { action: 'agent', agent: 'worker', route: { provider: 'subscription', model: 'small' } });
    await agents.press('추론: High');
    assert.deepEqual(calls.at(-1), { action: 'agent', agent: 'worker', route: { effort: 'high' } });
    await agents.press('Fast: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'agent', agent: 'worker', route: { fast: true } });
    const inputsBefore = agents.tree.root.findAllByType('input').length;
    await agents.press('원본 에이전트 정의 보기 (읽기 전용)');
    assert.deepEqual(calls.at(-1), { action: 'agentDefinition', agent: 'worker' });
    const shown = agents.tree.root.findAll((node) => node.type === 'text' && node.props.accessibilityLabel === '원본 에이전트 정의');
    assert.equal(shown.length, 1);
    assert.equal(shown[0].children.join(''), definition.body);
    assert.equal(agents.tree.root.findAllByType('input').length, inputsBefore);
    assert.match(JSON.stringify(agents.tree.toJSON()), /사용자 재정의/);
    const callCount = calls.length;
    await agents.press('원본 에이전트 정의 닫기');
    assert.equal(calls.length, callCount);
    assert.equal(agents.tree.root.findAll((node) => node.props.accessibilityLabel === '원본 에이전트 정의').length, 0);

    // 조회 실패는 저장 완료로 오인하지 않도록 화면에 표시한다.
    globalThis.__paseodogTestRpc = async () => { throw new Error('설정 서버 연결 실패'); };
    await agents.press('새로고침');
    assert.match(JSON.stringify(agents.tree.toJSON()), /설정 서버 연결 실패/);

    assert.equal(liveScreen.id, 'mixdog-live');
    globalThis.__paseodogTestRpc = async () => ({
        observedAt: Date.now(),
        sessions: [{ id: 's1', state: 'waiting-approval', approvalCount: 1,
            workflow: { id: 'default', name: 'Default' }, orchestration: 'swarm',
            model: 'small', provider: 'subscription', effort: 'low', compaction: { auto: true },
            jobs: [{ id: 'job_native', agent: 'worker', tag: 'review', model: 'small',
                provider: 'subscription', status: 'running', waitingApproval: true }] }],
    });
    let liveTree;
    await act(async () => {
        liveTree = create(React.createElement(liveScreen.Component, {
            theme: { colors: { foreground: '#ffffff' } }, host: { id: 'test', label: 'test' },
            layout: { compact: true, platform: 'android' },
        }));
    });
    assert.match(JSON.stringify(liveTree.toJSON()), /승인 대기/);
    assert.match(JSON.stringify(liveTree.toJSON()), /job_native/);
    assert.match(JSON.stringify(liveTree.toJSON()), /Default/);
    await act(async () => liveTree.unmount());
});

test('subscription login runs only inside a modal with code, back and cancel handling', async (t) => {
    const { settingsScreens, settings, renderScreen } = await loadClient(t);
    const authCalls = [];
    const controlCalls = [];
    const secret = 'secret-code-123';
    const flowIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003'];
    let authReply;
    globalThis.__paseodogTestRpc = async (input, name) => {
        if (name !== 'engine-auth') {
            controlCalls.push(input);
            return { route: { provider: 'subscription', model: 'small', autoEffort: false, fast: false },
                models: [], compaction: { auto: true }, workflows: [], orchestration: 'balanced', agents: [], sessions: [] };
        }
        authCalls.push(input);
        return authReply(input);
    };
    // 모달은 구독 계정 화면에만 있고 다른 설정 화면에는 없다.
    for (const item of settingsScreens.filter((entry) => entry.id !== 'mixdog-account')) {
        const other = await renderScreen(item);
        assert.equal(other.tree.root.findAllByType('modal').length, 0);
        assert.ok(!other.labels().includes('구독 계정 로그인'));
    }
    controlCalls.length = 0;
    const { tree, press, labels } = await renderScreen(settings('mixdog-account'));
    assert.ok(!labels().some((label) => /balanced|자동 압축|Worker|지침 파일|새로고침|모델 선택/.test(label)));
    const modal = () => tree.root.findByType('modal');
    const modalText = () => modal().findAllByType('text').flatMap((node) => node.children).join('\n');
    const codeInputs = () => tree.root.findAll((node) => node.type === 'input' && node.props.accessibilityLabel === '인증 코드');
    assert.equal(modal().props.visible, false);
    assert.equal(codeInputs().length, 0);

    // 모달 열기만으로는 어떤 로그인 RPC도 호출하지 않는다.
    await press('구독 계정 로그인');
    assert.equal(modal().props.visible, true);
    assert.equal(authCalls.length, 0);

    authReply = async () => ({ connected: false, state: 'idle' });
    await press('ChatGPT 구독 (OpenAI)');
    await press('연결 상태 확인');
    assert.deepEqual(authCalls.at(-1), { action: 'status', provider: 'openai-oauth' });
    assert.match(modalText(), /연결된 계정 없음/);
    // 다른 계정 공급자를 고르면 이전 공급자의 상태 문구를 지운다.
    await press('Claude 구독 (Anthropic)');
    assert.doesNotMatch(modalText(), /연결된 계정 없음/);
    await press('ChatGPT 구독 (OpenAI)');

    authReply = async () => ({ id: flowIds[0], state: 'pending', url: 'https://auth.example/authorize?state=x',
        userCode: 'ABCD-EFGH', acceptsCode: true });
    await press('로그인 시작');
    assert.deepEqual(authCalls.at(-1), { action: 'start', provider: 'openai-oauth' });
    assert.equal(codeInputs().length, 1);
    assert.ok(modal().findAll((node) => node.type === 'input').includes(codeInputs()[0]));
    assert.equal(codeInputs()[0].props.secureTextEntry, true);
    assert.match(modalText(), /ABCD-EFGH/);
    await press('브라우저에서 로그인 페이지 열기');
    assert.deepEqual(globalThis.__paseodogOpenedUrls, ['https://auth.example/authorize?state=x']);

    await act(async () => codeInputs()[0].props.onChangeText(`  ${secret} `));
    authReply = async () => ({ state: 'completed' });
    await press('코드 제출');
    assert.deepEqual(authCalls.at(-1), { action: 'complete', provider: 'openai-oauth', id: flowIds[0], code: secret });
    assert.equal(codeInputs().length, 0);
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), new RegExp(secret));
    assert.match(modalText(), /로그인 완료/);

    // 서버 오류는 모달 안에 표시하고 흐름을 남기지 않는다.
    authReply = async () => { throw new Error('계정 연결에 실패했어요. 새 로그인으로 다시 시도해 주세요.'); };
    await press('로그인 시작');
    assert.match(modalText(), /계정 연결에 실패했어요/);
    assert.equal(codeInputs().length, 0);

    // 모달 안 취소 버튼은 진행 중인 흐름을 취소하고 모달은 유지한다.
    authReply = async () => ({ id: flowIds[1], state: 'pending', url: 'https://auth.example/a', userCode: null, acceptsCode: true });
    await press('로그인 시작');
    await act(async () => codeInputs()[0].props.onChangeText(secret));
    authReply = async () => ({ state: 'idle' });
    await press('진행 중인 로그인 취소');
    assert.deepEqual(authCalls.at(-1), { action: 'cancel', provider: 'openai-oauth', id: flowIds[1] });
    assert.equal(modal().props.visible, true);
    assert.equal(codeInputs().length, 0);

    // Android 뒤로가기(onRequestClose)는 진행 중 로그인을 취소하고 입력값을 폐기한다.
    authReply = async () => ({ id: flowIds[2], state: 'pending', url: 'https://auth.example/b', userCode: null, acceptsCode: true });
    await press('로그인 시작');
    await act(async () => codeInputs()[0].props.onChangeText(secret));
    authReply = async () => ({ state: 'idle' });
    await act(async () => modal().props.onRequestClose());
    assert.deepEqual(authCalls.at(-1), { action: 'cancel', provider: 'openai-oauth', id: flowIds[2] });
    assert.equal(modal().props.visible, false);
    assert.equal(codeInputs().length, 0);
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), new RegExp(secret));

    // 시작 응답 전에 닫으면 늦게 도착한 흐름을 서버에서 취소한다.
    await press('구독 계정 로그인');
    let resolveStart;
    authReply = (input) => input.action === 'start'
        ? new Promise((resolve) => { resolveStart = resolve; }) : Promise.resolve({ state: 'idle' });
    await press('로그인 시작');
    await press('닫기');
    await act(async () => resolveStart({ id: flowIds[0], state: 'pending', url: 'https://auth.example/c', acceptsCode: true }));
    assert.deepEqual(authCalls.at(-1), { action: 'cancel', provider: 'openai-oauth', id: flowIds[0] });
    assert.equal(modal().props.visible, false);
    assert.equal(codeInputs().length, 0);

    // 늦은 시작 응답의 취소 실패도 숨기지 않고 설정 화면에 표시한다.
    await press('구독 계정 로그인');
    authReply = (input) => input.action === 'start'
        ? new Promise((resolve) => { resolveStart = resolve; })
        : Promise.reject(new Error('서버 연결 끊김'));
    await press('로그인 시작');
    await press('닫기');
    await act(async () => resolveStart({ id: flowIds[1], state: 'pending', url: 'https://auth.example/d', acceptsCode: true }));
    assert.equal(modal().props.visible, false);
    assert.match(JSON.stringify(tree.toJSON()), /로그인 취소 확인 실패: 서버 연결 끊김/);
    assert.equal(controlCalls.length, 0);
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
