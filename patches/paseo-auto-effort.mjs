// 로컬 패치: PaseoDog 입력창의 추론 수준(Effort) 목록에 호스트 자동 추론 항목을 넣고 중복 스위치를 걷어낸다.
export const AUTO_EFFORT_ID = 'paseodog:auto-effort';

// 호스트 Main 경로의 autoEffort 실제 값을 읽고, 명시적 선택만 저장하며 실패한 저장은 재전송하지 않는다.
export function createAutoEffortState(client) {
    let snapshot = { enabled: null, available: false, busy: false, error: '' };
    const listeners = new Set();
    // 상태 변경을 같은 호스트의 모든 입력창에 전달한다.
    function publish(update) {
        snapshot = { ...snapshot, ...update };
        for (const listener of listeners) listener();
    }
    // 읽기와 저장을 직렬화하고 성공 여부를 돌려준다. 불확실한 결과는 다시 읽기 전까지 알 수 없음으로 둔다.
    async function request(input) {
        if (snapshot.busy) return false;
        publish({ busy: true, error: '' });
        try {
            const value = await client.invokePluginRpc('paseodog-provider', 'engine-controls', input);
            if (typeof value?.route?.autoEffort !== 'boolean') throw new Error('Unsupported auto effort snapshot');
            const module = value.toolModules?.autoEffort;
            publish({ enabled: value.route.autoEffort, available: Boolean(value.route.model?.trim()) && module?.supported !== false && module?.enabled === true });
            return true;
        } catch {
            publish({ enabled: null, error: '자동 추론 설정 결과를 확인할 수 없어요. 다시 선택하면 새로고침만 해요.' });
            return false;
        } finally {
            publish({ busy: false });
        }
    }
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh: () => request({ action: 'read' }),
        setEnabled: (enabled) => request({ action: 'main', route: { autoEffort: enabled } }),
    };
}

// 기존 컨트롤 바를 그대로 렌더하되 PaseoDog일 때만 Effort 목록 맨 앞에 자동 추론 항목을 붙인다.
// 새 에이전트 입력창은 새 세션이 물려받는 호스트 기본값, 열린 세션은 세션 설정의 autoEffort 토글만 쓴다.
export function autoEffortControls({ props: input, client, agentId, React, jsx, Controls }) {
    const { paseodogScope, ...props } = input;
    const paseodog = props.provider === 'paseodog' && paseodogScope === 'draft';
    // 저장 표시는 에이전트별로 묶어 같은 컴포넌트가 다른 에이전트로 바뀌면 이전 결과를 보이지 않는다.
    const [savedState, setLiveSave] = React.useState({ agentId: null, busy: false, error: '' });
    const liveSave = savedState.agentId === agentId ? savedState : { agentId, busy: false, error: '' };
    const state = React.useMemo(() => {
        if (!client || !paseodog) return null;
        let state = autoEffortHosts.get(client);
        if (!state) {
            state = createAutoEffortState(client);
            autoEffortHosts.set(client, state);
        }
        return state;
    }, [client, paseodog]);
    const snapshot = React.useSyncExternalStore(state?.subscribe || autoEffortEmptySubscribe,
        state?.getSnapshot || autoEffortEmptySnapshot);
    React.useEffect(() => {
        if (!state) return;
        void state.refresh();
        // 설정 화면이나 다른 클라이언트에서 바뀐 호스트 값을 앱 복귀 시 다시 읽는다.
        const refresh = () => { void state.refresh(); };
        globalThis.addEventListener?.('focus', refresh);
        return () => globalThis.removeEventListener?.('focus', refresh);
    }, [state]);
    const options = props.thinkingOptions;
    const select = props.onSelectThinkingOption;
    if (props.provider === 'paseodog' && paseodogScope === 'live')
        return liveAutoEffortControls({ props, options, select, client, agentId, liveSave, setLiveSave, jsx, Controls });
    // 자동 추론 모듈이 꺼졌거나 추론 수준을 바꿀 수 없는 모델이면 항목을 만들지 않는다.
    if (!state || !snapshot.available || !options?.length) return jsx(Controls, props);
    const label = snapshot.error ? '자동 추론 (확인 필요)' : 'Auto';
    return jsx(Controls, {
        ...props,
        thinkingOptions: [{ id: AUTO_EFFORT_ID, label }, ...options.filter((option) => option.id !== AUTO_EFFORT_ID)],
        selectedThinkingOptionId: snapshot.enabled === true ? AUTO_EFFORT_ID : props.selectedThinkingOptionId,
        onSelectThinkingOption: (id, ...rest) => {
            // 결과를 모르는 상태에서는 저장하지 않고 실제 값만 다시 읽는다.
            if (snapshot.enabled === null) { void state.refresh(); return; }
            if (id === AUTO_EFFORT_ID) {
                if (!snapshot.enabled) void state.setEnabled(true);
                return;
            }
            // 수동 수준 선택은 호스트 자동 추론을 먼저 끄고, 저장이 확인된 뒤에만 기존 선택 경로로 넘긴다.
            if (!snapshot.enabled) { select?.(id, ...rest); return; }
            void state.setEnabled(false).then((saved) => { if (saved) select?.(id, ...rest); });
        },
    });
}

// 열린 세션: 세션 설정이 실제 autoEffort 토글을 내줄 때만 항목을 보이고, 호스트 값으로 대신하지 않는다.
// 자동은 SDK setAgentFeature 한 번, 수동은 기존 setAgentThinkingOption 경로 한 번이며 백엔드가 그 세션만 자동을 끈다.
export function liveAutoEffortControls({ props, options, select, client, agentId, liveSave, setLiveSave, jsx, Controls }) {
    const toggle = props.features?.find((feature) => feature.id === 'autoEffort');
    if (!toggle || toggle.type !== 'toggle' || typeof toggle.value !== 'boolean' || !options?.length || !client || !agentId)
        return jsx(Controls, props);
    const label = liveSave.error ? '자동 추론 (저장 실패 · 다시 선택)' : liveSave.busy ? '자동 추론 (저장 중)' : 'Auto';
    return jsx(Controls, {
        ...props,
        // 같은 세션 토글이 기능 목록에 중복으로 보이지 않게 Effort 목록으로만 옮긴다.
        features: props.features.filter((feature) => feature !== toggle),
        thinkingOptions: [{ id: AUTO_EFFORT_ID, label }, ...options.filter((option) => option.id !== AUTO_EFFORT_ID)],
        selectedThinkingOptionId: toggle.value ? AUTO_EFFORT_ID : props.selectedThinkingOptionId,
        onSelectThinkingOption: (id, ...rest) => {
            if (liveSave.busy) return;
            if (id !== AUTO_EFFORT_ID) { setLiveSave({ agentId, busy: false, error: '' }); select?.(id, ...rest); return; }
            if (toggle.value) return;
            // 실패하면 표시만 남기고 자동 재전송하지 않는다. 확정 값은 데몬이 보내는 세션 설정으로만 바뀐다.
            setLiveSave({ agentId, busy: true, error: '' });
            client.setAgentFeature(agentId, 'autoEffort', true).then(
                () => setLiveSave({ agentId, busy: false, error: '' }),
                (error) => setLiveSave({ agentId, busy: false, error: String(error?.message || error) }));
        },
    });
}

const autoEffortHosts = new WeakMap();
const autoEffortEmptyState = { enabled: null, available: false, busy: false, error: '' };
// 연결이 없는 렌더는 구독 없이 고정 상태를 사용한다.
function autoEffortEmptySubscribe() { return () => {}; }
// 연결 전 상태를 안정된 참조로 반환한다.
function autoEffortEmptySnapshot() { return autoEffortEmptyState; }

export const AUTO_EFFORT_SOURCE_ANCHOR = 'function Y(e,o,t){if(!e||0===e.length)return t;';
export const AUTO_EFFORT_SOURCE = `const autoEffortHosts=new WeakMap();
const autoEffortEmptyState={enabled:null,available:false,busy:false,error:""};
const AUTO_EFFORT_ID=${JSON.stringify(AUTO_EFFORT_ID)};
// 기존 세션 에이전트 ID: 컴파일러 캐시 밖에서 매 렌더 갱신되는 컨텍스트로 전달한다.
const PaseodogAgentScope=s.createContext(null);
${autoEffortEmptySubscribe.toString()}
${autoEffortEmptySnapshot.toString()}
${createAutoEffortState.toString()}
${liveAutoEffortControls.toString()}
${autoEffortControls.toString()}
// 두 컨트롤 모두 같은 세션 저장소에서 선택된 호스트의 SDK 클라이언트를 읽는다.
function PaseodogEffortControls(props){const serverId=props.modelSelectorServerId;const agentId=s.useContext(PaseodogAgentScope);const client=(0,O.useSessionStore)(e=>serverId?e.sessions[serverId]?.client??null:null);return (0,J.jsx)(autoEffortControls,{props,client,agentId,React:s,jsx:J.jsx,Controls:ve})}
${AUTO_EFFORT_SOURCE_ANCHOR}`;

// [원본, 패치] 쌍: 기존 세션·새 에이전트 컨트롤 바, 모델 선택창·모바일 시트의 중복 행, 토큰 설정의 중복 스위치.
export const AUTO_EFFORT_EDITS = [
    ['(0,J.jsx)(ve,{provider:h.provider,', '(0,J.jsx)(PaseodogEffortControls,{paseodogScope:"live",provider:h.provider,', 1],
    // 캐시된 컨트롤 바 요소와 무관하게 매 렌더 최신 agentId(t)를 컨텍스트로 감싼다(캐시 슬롯·훅 수 변경 없음).
    ['):Co=o[131],', '):Co=o[131],Co=(0,J.jsx)(PaseodogAgentScope.Provider,{value:t,children:Co}),', 1],
    ['(0,J.jsx)(ve,{provider:te,', '(0,J.jsx)(PaseodogEffortControls,{paseodogScope:"draft",provider:te,', 1],
    ['(0,C.jsx)(P.PaseodogAutoEffort,{serverId:oe},oe)', 'null/*paseodog-auto-effort:model-selector*/', 1],
    ['(0,j.jsx)(_.PaseodogAutoEffort,{serverId:ee},ee)', 'null/*paseodog-auto-effort:compact-sheet*/', 2],
    [String.raw`le=(0,C.jsx)(I,{title:"\uc790\ub3d9 \ucd94\ub860 \uc870\uc808 (Auto-Effort)",hint:"\ub2e8\uc21c \uc791\uc5c5\uc5d4 \ub0ae\uc740 \ucd94\ub860, \ubcf5\uc7a1\ud55c \uc791\uc5c5\uc5d4 \ub192\uc740 \ucd94\ub860\uc744 \uc790\ub3d9 \ubc30\uc815",children:(0,C.jsx)(w.Switch,{accessibilityLabel:"\ud1a0\ud070\uc808\uac10 \uc790\ub3d9 \ucd94\ub860 \uc870\uc808",disabled:s,value:l.route.autoEffort,onValueChange:m})})`,
        'le=null/*paseodog-auto-effort:token-settings*/', 1],
];

// 훅 전체가 있을 때만 제거해 원본 해시 검증을 유지한다.
export function withoutAutoEffort(source) {
    const previous = AUTO_EFFORT_SOURCE.replace('Boolean(value.route.model?.trim()) && ', '');
    const versions = [AUTO_EFFORT_SOURCE, previous].flatMap((value) => [
        value,
        value.replace("'자동 추론 (확인 필요)' : 'Auto'", "'자동 추론 (확인 필요)' : '자동 추론 (호스트 기본)'")
            .replace("'자동 추론 (저장 중)' : 'Auto'", "'자동 추론 (저장 중)' : '자동 추론 (이 세션)'"),
    ]);
    const installed = versions.find((value) => source.includes(value)) || AUTO_EFFORT_SOURCE;
    const markers = [installed, ...AUTO_EFFORT_EDITS.map(([, after]) => after)];
    const present = markers.map((marker) => source.includes(marker));
    if (present.every((value) => !value)) return source;
    if (!present.every(Boolean)) throw new Error('Partial Paseo auto effort patch');
    let result = source.replace(installed, AUTO_EFFORT_SOURCE_ANCHOR);
    for (const [before, after] of AUTO_EFFORT_EDITS) result = result.replaceAll(after, before);
    return result;
}

// 전체 원본 해시를 통과한 번들의 정확한 앵커 개수에만 훅을 붙인다.
export function withAutoEffort(source) {
    const anchors = [[AUTO_EFFORT_SOURCE_ANCHOR, AUTO_EFFORT_SOURCE, 1], ...AUTO_EFFORT_EDITS];
    for (const [before, , count] of anchors) {
        if (source.split(before).length !== count + 1) throw new Error('Paseo auto effort anchor mismatch');
    }
    let result = source;
    for (const [before, after] of anchors) result = result.replaceAll(before, after);
    return result;
}
