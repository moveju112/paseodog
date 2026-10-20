import { attachHostPolicy } from './policy.mjs';

// 네이티브 에이전트 실행은 유지하고 소유권·승인·취소·표시만 호스트에 연결한다.
export function createOrchestrationBridge({ config, pendingMessages = () => [] }) {
    let manager, getAgentTool, active = null, leadId = null;
    const owners = new Set();

    // 부모 체인을 따라 현재 Paseo 세션에 속한 하위 작업만 허용한다.
    function assertOwned(session) {
        if (!session?.id || !leadId) throw new Error('Agent has no active Paseo owner');
        let current = session;
        const visited = new Set();
        while (current?.id !== leadId) {
            if (!current?.id || visited.has(current.id)) throw new Error('Foreign agent session refused');
            visited.add(current.id);
            const parent = current.parentSessionId || current.ownerSessionId;
            if (parent === leadId) break;
            current = manager.getSession(parent);
        }
        for (const id of visited) owners.add(id);
    }

    // 취소되거나 교체된 턴의 콜백은 다시 사용할 수 없다.
    function assertActive(turn = active) {
        if (!turn || turn !== active || turn.controller.signal.aborted)
            throw new Error('Orchestration turn is no longer active');
        return turn;
    }

    // 이벤트 구독 후 상태를 확인해 작업 완료 경쟁을 피한다.
    async function waitForJobs(ownerId, turn) {
        assertActive(turn);
        const tool = getAgentTool();
        const running = () => (tool.getStatus({ callerSessionId: ownerId }).jobs || [])
            .some((job) => job.status === 'running');
        await new Promise((resolve, reject) => {
            let unsubscribe = () => {};
            const signal = turn.controller.signal;
            // 구독·취소 리스너를 함께 정리한다.
            const finish = (error) => {
                unsubscribe();
                signal.removeEventListener('abort', canceled);
                if (error) reject(error); else resolve();
            };
            // 승인 대기 중 취소도 즉시 부모 대기까지 전파한다.
            const canceled = () => finish(new Error('Orchestration interrupted'));
            // 작업 상태는 네이티브 이벤트로만 다시 확인한다.
            const changed = () => {
                try { if (!running()) finish(); } catch (error) { finish(error); }
            };
            unsubscribe = tool.onStatusChange(changed);
            signal.addEventListener('abort', canceled, { once: true });
            if (signal.aborted) canceled(); else changed();
        });
    }

    // 네이티브 완료 큐를 소모하는 후속 추론도 같은 Paseo 턴 안에서 실행한다.
    async function drain(ownerId, turn, askAgain, result) {
        for (;;) {
            await waitForJobs(ownerId, turn);
            assertActive(turn);
            if (!(await pendingMessages(ownerId)).length) return result;
            const next = await askAgain();
            // 전달 완료 ledger에 남은 항목은 네이티브 큐에서 걸러져 추론 없이 끝날 수 있다.
            if (next === undefined || (Object.hasOwn(next, 'result') && next.result === undefined))
                return result;
            result = next;
        }
    }

    // 하위 도구 ID에 세션을 붙여 병렬 호출의 표시 충돌을 막는다.
    function scopedId(session, id) {
        return `${session.id}:${String(id || '')}`;
    }

    // 원본 hook과 호스트 표시를 모두 보존하되 하위 텍스트는 부모 답변에 섞지 않는다.
    async function runChild({ session, prompt, context, cwd, ...hooks }) {
        const turn = assertActive();
        assertOwned(session);
        attachHostPolicy(session, { mode: config.mode || 'ask',
            systemPrompt: config.systemPrompt || '', orchestration: true });
        const callbacks = turn.callbacks;
        const label = session.agentTag || session.agent || session.id;
        const signal = hooks.signal
            ? AbortSignal.any([hooks.signal, turn.controller.signal]) : turn.controller.signal;
        const childHooks = {
            ...hooks, signal, hostManagedCompletions: true,
            onTextReset: () => false,
            onToolApproval: async (info) => {
                assertActive(turn);
                const answer = await callbacks.onToolApproval?.({ ...info,
                    sessionId: leadId, childSessionId: session.id,
                    reason: `[Agent ${label} / ${session.id}] ${info.reason || ''}` });
                assertActive(turn);
                return answer || { approved: false, reason: 'Paseo approval callback missing' };
            },
            onToolResult: (result) => {
                hooks.onToolResult?.(result);
                if (turn === active && !signal.aborted) callbacks.onToolResult?.({ ...result,
                    toolCallId: scopedId(session, result.toolCallId) });
            },
            onUsageDelta: (delta) => {
                hooks.onUsageDelta?.(delta);
                if (turn === active && !signal.aborted) callbacks.onUsageDelta?.(delta);
            },
            onAssistantToolCallObserved: (call) => {
                hooks.onAssistantToolCallObserved?.(call);
                if (turn === active && !signal.aborted)
                    callbacks.onAssistantToolCallObserved?.({ ...call,
                        id: scopedId(session, call.id), childSessionId: session.id });
            },
        };
        // 자식 세션의 네이티브 ask 경로를 그대로 사용한다.
        const ask = (text) => manager.askSession(session.id, text, context || null,
            (iteration, calls) => {
                if (turn === active && !signal.aborted) callbacks.onToolCall?.(iteration,
                    calls.map((call) => ({ ...call,
                        id: scopedId(session, call.id), childSessionId: session.id })));
            }, cwd, null, childHooks);
        return drain(session.id, turn, () => ask(''), await ask(prompt));
    }

    return {
        // 네이티브 sessionSurface 확장점에 승인 경계를 주입한다.
        surface({ mgr, getAgentTool: getter }) {
            manager = mgr;
            getAgentTool = getter;
            return {
                runTurn: runChild,
                canRun: () => true,
                // 진행 중인 자식의 후속 지시도 기존 네이티브 큐에 넣는다.
                enqueueTurn({ session, prompt }) {
                    assertActive(); assertOwned(session);
                    return { queueDepth: manager.enqueuePendingMessage(session.id, prompt) };
                },
                // 같은 tag의 명시적 모델 변경을 네이티브 경로로 처리한다.
                setRoute({ session, route }) {
                    assertActive(); assertOwned(session);
                    return manager.updateSessionRoute(session.id, route,
                        { crossProvider: Boolean(route.provider && route.provider !== session.provider) });
                },
            };
        },
        // 하나의 사용자 턴에만 승인 콜백을 연결한다.
        begin(callbacks) {
            if (active) throw new Error('Orchestration turn already active');
            active = { callbacks, controller: new AbortController() };
        },
        // 복원된 부모도 첫 추론 전에 소유권을 고정한다.
        bind(session) {
            assertActive();
            if (leadId && leadId !== session.id) throw new Error('Orchestration owner changed');
            leadId = session.id;
            owners.add(leadId);
        },
        // 부모의 최종 응답은 모든 하위 완료를 회수한 뒤 확정한다.
        drainLead(askAgain, result) {
            return drain(leadId, assertActive(), askAgain, result);
        },
        // 정상 완료 뒤에는 다음 사용자 턴까지 승인을 닫는다.
        finish() { active = null; },
        // 준비 중인 작업과 중첩 하위 작업까지 소유자별로 취소한다.
        // 이 Paseo 세션이 소유한 작업의 실행 상태만 공개한다.
        status() {
            if (!getAgentTool || !leadId) return [];
            const jobs = new Map();
            for (const owner of owners) {
                for (const job of getAgentTool().getStatus({ callerSessionId: owner }).jobs || []) {
                    const id = job.task_id || job.id || job.taskId;
                    if (!id) continue;
                    jobs.set(id, { id, sessionId: job.sessionId || null, ownerSessionId: owner,
                        agent: job.agent || '', tag: job.tag || '', status: job.status,
                        provider: job.provider || '', model: job.model || '', effort: job.effort || '',
                        stage: job.worker_stage || '', startedAt: job.startedAt || null, finishedAt: job.finishedAt || null });
                }
            }
            return [...jobs.values()];
        },
        async abort(reason) {
            active?.controller.abort(new Error(reason || 'Orchestration interrupted'));
            if (!getAgentTool) return;
            for (const owner of [...owners].reverse()) {
                const result = await getAgentTool().closeAll(reason, { callerSessionId: owner });
                if (result?.failed?.length) throw new Error('Failed to stop owned agent sessions');
            }
        },
    };
}
