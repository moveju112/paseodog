// 로컬 패치: 검토된 AgentTracks 모듈의 diff 알약 직전에 현재 부모 세션의 하위 작업 진행 알약을 넣는다.
import { createLiveMonitor } from '../plugin/client/live-monitor.mjs';

// Mixdog 상태줄 분류로 부모 세션 하위 작업을 실행·승인 대기·실행 대기로 센다 (종료·유휴 제외).
export function summarizeAgentJobs(jobs) {
    const terminal = /idle|done|complete|success|closed|error|fail|cancel|killed|timeout/i;
    const active = /^(?:connecting|requesting|streaming|tool[-_\s]?running|running|queued|pending|starting)$/i;
    const queued = /^(?:queued|pending|starting)$/i;
    const summary = { running: 0, waiting: 0, queued: 0, jobs: [] };
    for (const job of Array.isArray(jobs) ? jobs : []) {
        const values = [job?.stage, job?.status].map((value) => String(value || '').trim())
            .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
        const status = String(job?.status || '').trim();
        const lifecycle = !status || values.some((value) => /cancel|killed/i.test(value)) ? values : [status];
        if (!lifecycle.length || lifecycle.some((value) => terminal.test(value))
            || !lifecycle.some((value) => active.test(value))) continue;
        const state = job.waitingApproval ? 'waiting' : lifecycle.every((value) => queued.test(value)) ? 'queued' : 'running';
        summary[state]++;
        summary.jobs.push({ id: String(job.id || summary.jobs.length), agent: String(job.agent || job.tag || 'Agent'),
            tag: String(job.tag || ''), state });
    }
    return summary.jobs.length ? summary : null;
}

// Paseo 에이전트 영속 핸들에서 PaseoDog 브리지 ID만 꺼낸다 (다른 공급자는 null).
export function paseodogBridgeId(agent) {
    if (agent?.provider !== 'paseodog') return null;
    let persistence = agent.persistence?.metadata?.pluginProviderPersistence;
    const handle = agent.persistence?.sessionId;
    if (!persistence && typeof handle === 'string' && handle.startsWith('plugin:')) {
        try { persistence = JSON.parse(handle.slice(7)); } catch { return null; }
    }
    const bridgeId = persistence?.data?.bridgeId;
    return typeof bridgeId === 'string' && bridgeId ? bridgeId : null;
}

// 호스트별 engine-status 조회를 하나로 묶고 보이는 구독자가 있을 때만 겹침 없이 갱신한다.
export function createAgentProgressState(client, { view = globalThis.document } = {}) {
    let snapshot = { rows: null, failed: false }, key = '', active = false;
    const listeners = new Set();
    // 바뀐 상태만 같은 호스트의 모든 알약에 전달한다.
    function publish(next) {
        snapshot = next;
        for (const listener of listeners) listener();
    }
    const monitor = createLiveMonitor({
        read: () => client.invokePluginRpc('paseodog-provider', 'engine-status', {}),
        onValue(value) {
            const rows = new Map();
            for (const row of Array.isArray(value?.sessions) ? value.sessions : []) {
                const summary = typeof row?.bridgeId === 'string' ? (['unavailable', 'failed'].includes(row.state) ? { failed: true } : summarizeAgentJobs(row.jobs)) : null;
                if (summary) rows.set(row.bridgeId, summary);
            }
            const nextKey = JSON.stringify([...rows]);
            if (nextKey === key && snapshot.rows && !snapshot.failed) return;
            key = nextKey;
            publish({ rows, failed: false });
        },
        onError() { if (!snapshot.failed) publish({ rows: snapshot.rows, failed: true }); },
    });
    // 구독자와 화면 표시 여부로 조회를 켜고 끄며 꺼질 때 지난 상태를 버린다.
    function update() {
        const next = listeners.size > 0 && view?.visibilityState !== 'hidden';
        if (next === active) return;
        active = next;
        if (!active) { key = ''; snapshot = { rows: null, failed: false }; }
        monitor.setActive(active);
    }
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) view?.addEventListener?.('visibilitychange', update);
            update();
            return () => {
                listeners.delete(listener);
                if (!listeners.size) view?.removeEventListener?.('visibilitychange', update);
                update();
            };
        },
    };
}

// 현재 부모 세션의 하위 작업 요약만 구독하고 PaseoDog 외 에이전트는 조회하지 않는다.
export function useAgentProgress({ React, client, agent }) {
    const bridgeId = paseodogBridgeId(agent);
    const state = React.useMemo(() => {
        if (!client || !bridgeId) return null;
        let state = agentProgressHosts.get(client);
        if (!state) {
            state = createAgentProgressState(client);
            agentProgressHosts.set(client, state);
        }
        return state;
    }, [client, bridgeId]);
    const snapshot = React.useSyncExternalStore(state?.subscribe || emptyProgressSubscribe,
        state?.getSnapshot || emptyProgressSnapshot);
    const summary = bridgeId && snapshot.rows?.get(bridgeId);
    if (snapshot.failed) return { running: 0, waiting: 0, queued: 0, jobs: [], failed: true };
    return summary || null;
}

// 요약을 트랙 알약 구간으로 바꾸며 활동이 없으면 빈 목록을 반환한다.
export function agentProgressSegments(progress) {
    if (!progress) return [];
    if (progress.failed) return [{ bucket: 'failed', text: '하위 작업 확인 불가' }];
    return [
        progress.running ? { bucket: 'running', text: `에이전트 ${progress.running} 실행` } : null,
        progress.waiting ? { bucket: 'needs_input', text: `${progress.waiting} 승인 대기` } : null,
        progress.queued ? { text: `${progress.queued} 실행 대기` } : null,
    ].filter(Boolean);
}

// 진행 중인 하위 작업만 diff 알약 옆 트랙 알약과 작업 목록으로 그린다.
export function renderAgentProgress({ progress, jsx, TrackPill, TrackRow, Text, textStyle }) {
    const segments = agentProgressSegments(progress);
    if (!segments.length) return null;
    const labels = { running: '실행 중', waiting: '승인 대기', queued: '실행 대기' };
    const line = (text, key) => jsx(TrackRow, { accessibilityLabel: text,
        children: jsx(Text, { style: textStyle, numberOfLines: 1, children: text }) }, key);
    const rows = progress.failed
        ? [line('연결이 끊겼거나 조회에 실패했어요. 다음 확인에서 다시 표시해요.', 'failed')]
        : progress.jobs.map((job) => line(`${job.agent}${job.tag && job.tag !== job.agent ? ` · ${job.tag}` : ''} · ${labels[job.state]}`, job.id));
    return jsx(TrackPill, {
        segments, panelTitle: '하위 에이전트 (이 세션)', testID: 'paseodog-agent-progress',
        accessibilityLabel: `이 세션 하위 에이전트: ${segments.map((segment) => segment.text).join(', ')}`,
        children: rows,
    });
}

const agentProgressHosts = new WeakMap();
const emptyProgress = { rows: null, failed: false };
// 연결·PaseoDog 세션이 없는 렌더는 조회하지 않는다.
function emptyProgressSubscribe() { return () => {}; }
// 조회 전 상태를 안정된 참조로 반환한다.
function emptyProgressSnapshot() { return emptyProgress; }

// 검토된 AgentTracks 모듈: diff 알약 요소는 그대로 두고 그 앞에 진행 알약을 넣으며 활동 중이면 트랙 바를 유지한다.
export const PROGRESS_SOURCE_ANCHOR = 'function F(s){return s.openInSidePane}},4998,[455,36,4999,4985,5000,5001,1218,4612,885,4770,3657,5002,5010,4014,3786,4610,4608,279]);';
export const PROGRESS_SOURCE = `function F(s){return s.openInSidePane}
const agentProgressHosts=new WeakMap();
const emptyProgress={rows:null,failed:false};
${emptyProgressSubscribe.toString()}
${emptyProgressSnapshot.toString()}
${createLiveMonitor.toString()}
${summarizeAgentJobs.toString()}
${paseodogBridgeId.toString()}
${createAgentProgressState.toString()}
${useAgentProgress.toString()}
${agentProgressSegments.toString()}
${renderAgentProgress.toString()}
// 검토된 모듈의 React·세션 저장소에서 현재 호스트 클라이언트와 부모 에이전트를 읽는다.
function usePaseodogAgentProgress(serverId,agentId){const client=(0,v.useSessionStore)(state=>state.sessions[serverId]?.client??null),agent=(0,v.useSessionStore)(state=>state.sessions[serverId]?.agents?.get(agentId)??null);return useAgentProgress({React:t,client,agent})}
// 기존 트랙 알약·행·글자 스타일을 재사용해 진행 상태를 그린다.
function PaseodogAgentProgress(props){return renderAgentProgress({progress:usePaseodogAgentProgress(props.serverId,props.agentId),jsx:T.jsx,TrackPill:u.ComposerTrackPill,TrackRow:u.ComposerTrackRow,Text:r(d[18]).Text,textStyle:r(d[19]).composerPillStyles.label})}
},4998,[455,36,4999,4985,5000,5001,1218,4612,885,4770,3657,5002,5010,4014,3786,4610,4608,279,898,4779]);`;
// Exact previous source is retained solely to upgrade already-patched bundles.
const LEGACY_PROGRESS_SOURCE = PROGRESS_SOURCE
    .replace("const summary = typeof row?.bridgeId === 'string' ? (['unavailable', 'failed'].includes(row.state) ? { failed: true } : summarizeAgentJobs(row.jobs)) : null;",
        "const summary = typeof row?.bridgeId === 'string' ? summarizeAgentJobs(row.jobs) : null;")
    .replace("if (snapshot.failed) return { running: 0, waiting: 0, queued: 0, jobs: [], failed: true };\n    return summary || null;",
        "if (!summary) return null;\n    return snapshot.failed ? { running: 0, waiting: 0, queued: 0, jobs: [], failed: true } : summary;");
export const PROGRESS_HOOK_ANCHOR = 'H=(0,o.useWorkspaceHasDiffStat)(j,D),';
export const PROGRESS_HOOK = 'H=(0,o.useWorkspaceHasDiffStat)(j,D),paseodogProgress=usePaseodogAgentProgress(j,x),';
export const PROGRESS_VISIBLE_ANCHOR = 'if(!H&&!A({subagentRows:_,tasks:W,archiveFinishedStatus:K,hasPluginComposerPills:R}))return null;';
export const PROGRESS_VISIBLE = 'if(!H&&!paseodogProgress&&!A({subagentRows:_,tasks:W,archiveFinishedStatus:K,hasPluginComposerPills:R}))return null;';
export const PROGRESS_RENDER_ANCHOR = 'children:[re,oe,ce,ie]';
export const PROGRESS_RENDER = 'children:[re,oe,ce,(0,T.jsx)(PaseodogAgentProgress,{serverId:j,agentId:x}),ie]';

const HOOKS = [
    [PROGRESS_SOURCE_ANCHOR, PROGRESS_SOURCE],
    [PROGRESS_HOOK_ANCHOR, PROGRESS_HOOK],
    [PROGRESS_VISIBLE_ANCHOR, PROGRESS_VISIBLE],
    [PROGRESS_RENDER_ANCHOR, PROGRESS_RENDER],
];

// 진행 훅 전체가 있을 때만 제거해 원본 해시 검증을 유지한다.
export function withoutAgentProgress(source) {
    const hooks = source.includes(LEGACY_PROGRESS_SOURCE)
        ? [[PROGRESS_SOURCE_ANCHOR, LEGACY_PROGRESS_SOURCE], ...HOOKS.slice(1)] : HOOKS;
    const present = hooks.map(([, patched]) => source.includes(patched));
    if (present.some((value) => value !== present[0])) throw new Error('Partial Paseo agent progress patch');
    return hooks.reduce((result, [anchor, patched]) => result.replace(patched, () => anchor), source);
}

// 전체 원본 해시를 통과한 번들의 정확한 앵커에만 진행 훅을 붙인다.
export function withAgentProgress(source) {
    for (const [anchor] of HOOKS) {
        if (source.split(anchor).length !== 2) throw new Error('Paseo agent progress anchor mismatch');
    }
    return HOOKS.reduce((result, [anchor, patched]) => result.replace(anchor, () => patched), source);
}
