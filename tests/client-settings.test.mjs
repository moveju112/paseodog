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
    let liveScreen;
    require(output).default({
        addSettingsScreen(value) { settingsScreens.push(value); return () => {}; },
        addScreen(value) { liveScreen = value; return () => {}; },
        addWorkspacePanel() { return () => {}; },
        addSidebarFooterItem() { return () => {}; },
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
    return { settingsScreens, settings, liveScreen, renderScreen };
}

// 라벨 기반 버튼 조회·누르기 도우미
function screenHelpers(tree) {
    const labels = () => tree.root.findAllByType('pressable').map((node) => node.findByType('text').children.join(''));
    const press = async (label) => {
        const element = tree.root.findAllByType('pressable').find((node) =>
            node.findByType('text').children.join('') === label);
        assert.ok(element, `button ${label}`);
        await act(async () => element.props.onPress());
    };
    return { tree, press, labels };
}

test('settings register separate sections without a main model picker and dispatch scoped changes', async (t) => {
    const { settingsScreens, settings, liveScreen, renderScreen } = await loadClient(t);
    assert.deepEqual(settingsScreens.map((item) => [item.id, item.title, item.icon]), [
        ['mixdog-account', '구독 계정', 'Bot'], ['mixdog-workflow', '워크플로', 'Bot'],
        ['mixdog-tokens', '토큰 절감', 'Bot'], ['mixdog-instructions', '지침 파일 로딩', 'Bot'],
        ['mixdog-agents', '에이전트', 'Bot'], ['mixdog-status', '실행 현황', 'Activity'],
    ]);
    for (const item of settingsScreens) assert.deepEqual(Object.keys(item).sort(), ['Component', 'icon', 'id', 'title']);
    assert.equal(settings('mixdog-status').Component, liveScreen.Component);
    const calls = [];
    const snapshot = {
        route: { provider: 'subscription', model: 'small', effort: 'low', fast: false, autoEffort: false },
        models: [{ provider: 'subscription', id: 'small', label: 'Small', fastCapable: true,
            effortOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }],
        compaction: { auto: true }, workflows: [{ id: 'default', name: 'Default', active: true }],
        orchestration: 'balanced', instructionFiles: 'all', agents: [{ id: 'worker', label: 'Worker', disabled: false,
            route: { provider: 'subscription', model: 'small', effort: 'low', autoEffort: false, fast: false } }],
        sessions: [{ id: 's1', running: true, model: 'small', compaction: { auto: true },
            context: { usedTokens: 42 }, jobs: [{ id: 'j1', agent: 'worker', status: 'running' }] }],
    };
    const definition = { id: 'worker', name: 'Worker', description: '검증 담당',
        body: '# Worker\n\n  keep   original\tspacing\n', custom: false, userOverride: true };
    let reply = (input) => input.action === 'agentDefinition' ? { ...snapshot, agentDefinition: definition }
        : input.action === 'workflowPack' ? { ...snapshot, workflowPack: { id: 'default', name: 'Default', body: '# Flow' } } : snapshot;
    globalThis.__paseodogTestRpc = async (input, name) => {
        assert.equal(name, 'engine-controls');
        calls.push(input);
        return reply(input);
    };
    const mainPicker = /^(✓ )?(Main|모델 선택|에이전트 모델 선택|추론: .*|Fast: .*|Small · subscription)$/;

    // 워크플로: 오케스트레이션·워크플로 보기/편집/생성만 표시한다.
    const workflow = await renderScreen(settings('mixdog-workflow'));
    assert.deepEqual(calls.at(-1), { action: 'read' });
    assert.ok(workflow.labels().includes('✓ balanced'));
    assert.ok(!workflow.labels().some((label) => mainPicker.test(label) || /자동 압축|Worker|지침 파일|구독 계정/.test(label)));
    assert.doesNotMatch(JSON.stringify(workflow.tree.toJSON()), /usedTokens|s1/);
    assert.equal(workflow.tree.root.findAllByType('modal').length, 0);
    await workflow.press('swarm');
    assert.deepEqual(calls.at(-1), { action: 'orchestration', mode: 'swarm' });
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
    await tokens.press('자동 추론 조절: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'main', route: { autoEffort: true } });
    await tokens.press('Fast 응답: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'main', route: { fast: true } });
    await tokens.press('자동 압축: 켜짐');
    assert.deepEqual(calls.at(-1), { action: 'compaction', enabled: false });
    await tokens.press('모델 변경 시 자동 압축: 꺼짐');
    assert.deepEqual(calls.at(-1), { action: 'compaction', onModelChange: true });
    await tokens.press('컨텍스트 버퍼 30%');
    assert.deepEqual(calls.at(-1), { action: 'compaction', mainBufferPercent: 0.3 });
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
    assert.ok(!calls.some((input) => 'language' in input || 'profile' in input));

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
        liveTree = create(React.createElement(settings('mixdog-status').Component, {
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
    for (const item of settingsScreens.filter((entry) => entry.id !== 'mixdog-account' && entry.id !== 'mixdog-status')) {
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
