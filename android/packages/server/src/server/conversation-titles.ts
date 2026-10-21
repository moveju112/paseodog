import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";

interface TitleInput {
  currentTitle: string;
  provisional: boolean;
  conversation: string;
}

interface ConversationTitleOptions {
  agentManager: Pick<AgentManager, "subscribe" | "getAgent" | "getTimeline" | "setGeneratedTitle">;
  agentStorage: Pick<AgentStorage, "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "update">;
  generateTitle: (input: TitleInput) => Promise<unknown>;
  emitWorkspaceUpdate: (workspaceId: string) => Promise<void>;
  logger: { warn: (context: object, message: string) => void };
}

// 출처가 확인된 자동 이름만 고르고 수동 이름·이전 버전의 불명확한 이름·보관은 제외한다.
function automaticTitleRecord<T extends { titleOrigin?: string; archivedAt?: string | null }>(
  record: T | null,
): T | null {
  if (!record || record.archivedAt) return null;
  return record.titleOrigin === "provisional" || record.titleOrigin === "generated" ? record : null;
}

// 제목 응답에서 길이·줄바꿈·제어 문자를 검사한 표시 문자열만 받는다.
function generatedTitleText(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("title" in result)) return null;
  const title = result.title;
  if (typeof title !== "string" || !title.trim() || title.length > 32 || /\p{Cc}/u.test(title))
    return null;
  return title.trim();
}

// 도구·추론·중간 안내는 제외하고 최근 완료된 세 대화의 사용자 요청과 마지막 응답만 남긴다.
export function conversationTitleSource(items: readonly AgentTimelineItem[]): string {
  const turns: { user: string; assistant: string }[] = [];
  for (const item of items) {
    if (item.type === "user_message" && item.text.trim()) {
      turns.push({ user: item.text.slice(0, 2000), assistant: "" });
    } else if (item.type === "assistant_message" && turns.length && item.text.trim()) {
      turns[turns.length - 1]!.assistant = item.text.slice(0, 4000);
    }
  }
  return turns
    .filter((turn) => turn.assistant)
    .slice(-3)
    .map((turn) => `User: ${turn.user}\nAssistant: ${turn.assistant}`)
    .join("\n\n");
}

// 완료 이벤트만 관찰하고 출처가 확인된 자동 제목을 원자적으로 갱신한다.
export function startConversationTitles(options: ConversationTitleOptions): () => void {
  const { agentManager, agentStorage, workspaceRegistry } = options;
  const revisions = new Map<string, object>();
  const workspaceRevisions = new Map<string, object>();
  let stopped = false;

  // 모델 응답을 기다리는 동안 새 턴·수동 이름 변경·보관이 생기면 오래된 결과를 버린다.
  async function update(agentId: string, revision: object): Promise<void> {
    const agent = agentManager.getAgent(agentId);
    if (!agent || agent.internal || agent.provider !== "paseodog") return;
    const stored = automaticTitleRecord(await agentStorage.get(agentId));
    const workspace = automaticTitleRecord(
      agent.workspaceId ? await workspaceRegistry.get(agent.workspaceId) : null,
    );
    const currentTitleRecord = stored ?? workspace;
    if (!currentTitleRecord) return;
    const conversation = conversationTitleSource(agentManager.getTimeline(agentId));
    if (!conversation) return;
    const currentTitle = currentTitleRecord.title ?? "";
    const result = await options.generateTitle({
      currentTitle,
      provisional: currentTitleRecord.titleOrigin === "provisional",
      conversation,
    });
    if (stopped || revisions.get(agentId) !== revision) return;
    const normalized = generatedTitleText(result);
    if (!normalized) return;
    // 동일 제목도 출처를 generated로 승격해 확정 상태를 다음 요청에 전달한다.
    if (stored) {
      await agentManager.setGeneratedTitle(
        agentId,
        normalized,
        stored.title ?? null,
        () => !stopped && revisions.get(agentId) === revision,
      );
    }
    if (workspace && workspaceRevisions.get(workspace.workspaceId) === revision) {
      let applied = false;
      await workspaceRegistry.update(workspace.workspaceId, (current) => {
        if (
          stopped ||
          revisions.get(agentId) !== revision ||
          workspaceRevisions.get(workspace.workspaceId) !== revision ||
          current.title !== workspace.title ||
          !automaticTitleRecord(current)
        )
          return current;
        if (current.title === normalized && current.titleOrigin === "generated") return current;
        applied = true;
        return {
          ...current,
          title: normalized,
          titleOrigin: "generated",
          updatedAt: new Date().toISOString(),
        };
      });
      if (applied) await options.emitWorkspaceUpdate(workspace.workspaceId);
    }
  }

  const unsubscribe = agentManager.subscribe(
    (event) => {
      if (event.type === "agent_state" && event.agent.lifecycle === "closed") {
        revisions.delete(event.agent.id);
        if (event.agent.workspaceId) workspaceRevisions.delete(event.agent.workspaceId);
        return;
      }
      if (event.type !== "agent_stream") return;
      const stream = event.event;
      if (
        stream.type !== "turn_started" &&
        stream.type !== "turn_completed" &&
        stream.type !== "turn_canceled" &&
        stream.type !== "turn_failed"
      )
        return;
      const agent = agentManager.getAgent(event.agentId);
      if (!agent || agent.internal || agent.provider !== "paseodog") return;
      const revision = {};
      revisions.set(event.agentId, revision);
      if (agent.workspaceId) workspaceRevisions.set(agent.workspaceId, revision);
      if (stream.type !== "turn_completed") return;
      void update(event.agentId, revision).catch((error: unknown) => {
        options.logger.warn(
          { err: error, agentId: event.agentId },
          "Conversation title generation failed",
        );
      });
    },
    { replayState: false },
  );

  return () => {
    stopped = true;
    unsubscribe();
    revisions.clear();
    workspaceRevisions.clear();
  };
}
