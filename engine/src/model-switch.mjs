import { selectedModel } from 'mixdog/src/session-runtime/model-route/model-switch-target.mjs';
import { sessionHasRouteHistory } from 'mixdog/src/runtime/agent/orchestrator/runtime-core/session-route-policy.mjs';
import { normalizeCompactionConfig } from 'mixdog/src/runtime/agent/orchestrator/runtime-core/config-helpers.mjs';
import { migrateCompactionBuffer } from './compaction-buffer.mjs';

// 모델을 바꾸기 전에 원래 모델의 컨텍스트를 압축한다. 검증·압축 실패는 모델 변경보다 먼저 전파한다.
export async function compactBeforeModelSwitch(runtime, request, loadConfig, assertActive) {
    const session = runtime.session;
    if (!sessionHasRouteHistory(session)) return;
    const target = selectedModel(runtime, request, session.provider, session.model);
    if (target.provider === session.provider && target.model === session.model) return;
    await runtime.setRoute(request, { validateOnly: true });
    assertActive();
    // 설정 화면은 별도 프로세스다. 다음 턴을 기다리지 않고 방금 저장한 압축 옵션을 읽는다.
    const latest = await loadConfig();
    assertActive();
    const compaction = normalizeCompactionConfig(migrateCompactionBuffer(latest.compaction));
    if (compaction.onModelChange === false) return;
    await runtime.setCompactionSettings({ ...compaction, summaryModel: compaction.summaryModel || '' });
    assertActive();
    try {
        const result = await runtime.compact();
        if (!result || result.error || result.reason === 'compact skipped: turn in progress')
            throw new Error('Native compaction did not complete');
    } catch (cause) {
        throw new Error('자동 압축에 실패해 모델을 바꾸지 않았어요. 압축 설정을 확인하거나 모델 변경 시 자동 압축을 끈 뒤 다시 선택해 주세요.', { cause });
    }
    assertActive();
    if (runtime.session?.id !== session.id)
        throw new Error('압축 중 세션이 변경되어 모델 변경을 중단했어요.');
}
