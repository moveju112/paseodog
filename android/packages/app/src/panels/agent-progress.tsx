import { useMemo, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { composerPillStyles } from "@/composer/pill-styles";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useSessionStore } from "@/stores/session-store";
import {
  agentProgressSegments,
  getAgentProgressState,
  paseodogBridgeId,
  selectAgentProgress,
  type AgentProgress,
} from "./agent-progress-state";

// 비활성 앱·다른 공급자·연결 전 화면에서는 호스트 조회를 구독하지 않는다.
function emptySubscribe(): () => void {
  return () => {};
}

// 숨김·연결 전 스냅샷은 안정된 빈 값으로 유지한다.
function emptySnapshot(): null {
  return null;
}

// 기존 AppState·웹 visibility 구독을 재사용해 현재 부모의 진행 상태만 읽는다.
export function useAgentProgress(
  serverId: string,
  agentId: string | undefined,
): AgentProgress | null {
  const visible = useAppVisible();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const agent = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agents.get(agentId) ?? null) : null,
  );
  const bridgeId = paseodogBridgeId(agent);
  const state = useMemo(() => {
    if (!client || !bridgeId || !visible) return null;
    return getAgentProgressState(client);
  }, [client, bridgeId, visible]);
  const snapshot = useSyncExternalStore(
    state?.subscribe ?? emptySubscribe,
    state?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  return snapshot ? selectAgentProgress(snapshot, bridgeId) : null;
}

// 기존 트랙의 sheet·popover와 글자 스타일을 재사용하며 diff 알약과 독립적으로 그린다.
export function AgentProgressPill({ progress }: { progress: AgentProgress | null }) {
  const segments = agentProgressSegments(progress);
  if (!progress || !segments.length) return null;
  const labels = { running: "실행 중", waiting: "승인 대기", queued: "실행 대기" };
  return (
    <ComposerTrackPill
      segments={segments}
      panelTitle="하위 에이전트 (이 세션)"
      testID="paseodog-agent-progress"
      accessibilityLabel={`이 세션 하위 에이전트: ${segments.map((segment) => segment.text).join(", ")}`}
    >
      {"failed" in progress ? (
        <ComposerTrackRow accessibilityLabel="하위 작업 확인 불가">
          <Text style={composerPillStyles.label}>
            연결이 끊겼거나 조회에 실패했어요. 다음 확인에서 다시 표시해요.
          </Text>
        </ComposerTrackRow>
      ) : (
        progress.jobs.map((job) => {
          const tag = job.tag && job.tag !== job.agent ? ` · ${job.tag}` : "";
          const text = `${job.agent}${tag} · ${labels[job.state]}`;
          return (
            <ComposerTrackRow key={job.id} accessibilityLabel={text}>
              <Text style={composerPillStyles.label} numberOfLines={1}>
                {text}
              </Text>
            </ComposerTrackRow>
          );
        })
      )}
    </ComposerTrackPill>
  );
}
