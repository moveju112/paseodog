// Android가 백그라운드 푸시의 data를 버려도 시스템 알림 tag에는 세션 식별자를 보존한다.
export function buildAgentNotificationTag(
  data: Record<string, unknown> | null | undefined,
): string | undefined {
  const serverId = typeof data?.serverId === "string" ? data.serverId.trim() : "";
  const agentId = typeof data?.agentId === "string" ? data.agentId.trim() : "";
  if (!serverId || !agentId) return undefined;
  return `paseodog-session:${JSON.stringify([serverId, agentId])}`;
}
