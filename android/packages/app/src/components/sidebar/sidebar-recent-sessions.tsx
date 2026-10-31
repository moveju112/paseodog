import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { WorkspaceStatusIndicator } from "@/components/sidebar/sidebar-workspace-row-content";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useRecentSessionsStore } from "@/stores/recent-sessions-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { requestSessionReveal } from "@/stores/session-reveal-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  effectiveRecentSessionsWindow,
  groupRecentSessionsBySplit,
  normalizeRecentSessionsWindows,
  recentSessionsWindowLabel,
  selectRecentSessions,
  selectSplitSessionGroups,
  type RecentSessionsWindow,
} from "@/utils/recent-sessions";
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";

// 분 단위 현재 시각 (공용 분 틱 -> 범위 재계산)
function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => subscribeToRelativeTimeTick("minute", () => setNow(new Date())), []);
  return now;
}

// 사이드바 최근 세션 섹션 (세션 스토어 -> 내 마지막 채팅 범위 필터 -> 누르면 해당 세션 이동)
export const SidebarRecentSessions = memo(function SidebarRecentSessions({
  onBeforeNavigate,
}: {
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const storedWindow = useRecentSessionsStore((state) => state.window);
  const storedWindows = useRecentSessionsStore((state) => state.windows);
  const setWindow = useRecentSessionsStore((state) => state.setWindow);
  const hiddenThrough = useRecentSessionsStore((state) => state.hiddenThrough);
  // 설정에서 고른 범위만 보이고, 빠진 범위를 고른 상태였으면 가까운 넓은 범위로 보인다.
  const windows = useMemo(() => normalizeRecentSessionsWindows(storedWindows), [storedWindows]);
  const window = effectiveRecentSessionsWindow(storedWindow, windows);
  const now = useMinuteNow();
  const agentsByServer = useSessionStore(
    useShallow((state) => {
      const result: Record<string, Map<string, Agent> | undefined> = {};
      for (const [serverId, session] of Object.entries(state.sessions)) {
        result[serverId] = session.agents;
      }
      return result;
    }),
  );
  const layoutByWorkspace = useWorkspaceLayoutStore((state) => state.layoutByWorkspace);
  const splitGroups = useMemo(
    () => selectSplitSessionGroups(layoutByWorkspace),
    [layoutByWorkspace],
  );
  // 분할 화면으로 함께 열린 최근 세션은 그중 가장 최근 세션 아래에 붙인다.
  const sessions = useMemo(
    () =>
      groupRecentSessionsBySplit(
        selectRecentSessions(agentsByServer, window, now, hiddenThrough),
        splitGroups,
      ),
    [agentsByServer, window, now, hiddenThrough, splitGroups],
  );

  return (
    <View style={styles.section} testID="sidebar-recent-sessions">
      <View style={styles.header}>
        <Text style={styles.title}>{t("sidebar.recentSessions.title")}</Text>
        <View style={styles.windows}>
          {windows.map((option) => (
            <RecentWindowOption
              key={option}
              label={recentSessionsWindowLabel(t, option)}
              accessibilityLabel={t("sidebar.recentSessions.windowAccessibility", {
                window: recentSessionsWindowLabel(t, option),
              })}
              option={option}
              selected={option === window}
              onSelect={setWindow}
            />
          ))}
        </View>
      </View>
      {sessions.length === 0 ? (
        <Text style={styles.empty}>{t("sidebar.recentSessions.empty")}</Text>
      ) : (
        // 고정 하단 영역이라 행이 많으면 이 목록만 스크롤해 작업공간 목록 높이를 지킨다.
        <ScrollView style={styles.rows} testID="sidebar-recent-sessions-rows">
          {sessions.map(({ agent, linked }) =>
            linked.length === 0 ? (
              <RecentSessionRow
                key={`${agent.serverId}:${agent.id}`}
                agent={agent}
                onBeforeNavigate={onBeforeNavigate}
              />
            ) : (
              // 분할 화면으로 함께 열린 세션: 옅은 강조 박스와 왼쪽 강조선으로 한 묶음 표시
              <View
                key={`${agent.serverId}:${agent.id}`}
                style={styles.splitBox}
                testID="sidebar-recent-split-group"
              >
                <View pointerEvents="none" style={styles.splitTint} />
                <View pointerEvents="none" style={styles.splitBar} />
                <RecentSessionRow
                  agent={agent}
                  linkedTo={linked
                    .map((item) => item.title || t("agentList.fallbackTitle"))
                    .join(", ")}
                  onBeforeNavigate={onBeforeNavigate}
                />
                {linked.map((linkedAgent) => (
                  <View
                    key={`${linkedAgent.serverId}:${linkedAgent.id}`}
                    style={styles.splitDivider}
                  >
                    <RecentSessionRow
                      agent={linkedAgent}
                      linkedTo={agent.title || t("agentList.fallbackTitle")}
                      onBeforeNavigate={onBeforeNavigate}
                    />
                  </View>
                ))}
              </View>
            ),
          )}
        </ScrollView>
      )}
    </View>
  );
});

// 범위 선택 칩 (누름 -> 저장된 범위 변경)
function RecentWindowOption({
  label,
  accessibilityLabel,
  option,
  selected,
  onSelect,
}: {
  label: string;
  accessibilityLabel: string;
  option: RecentSessionsWindow;
  selected: boolean;
  onSelect: (window: RecentSessionsWindow) => void;
}) {
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const labelStyle = useMemo(
    () => [styles.windowLabel, selected && styles.windowLabelSelected],
    [selected],
  );
  const style = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.windowOption,
      (selected || hovered) && styles.windowOptionActive,
    ],
    [selected],
  );
  return (
    <Pressable
      style={style}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      testID={`sidebar-recent-window-${option}`}
      hitSlop={4}
    >
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
}

// 최근 세션 행 (상태 링·체크·제목·경과 시간 -> 누르면 세션 이동)
function RecentSessionRow({
  agent,
  linkedTo,
  onBeforeNavigate,
}: {
  agent: Agent;
  /** 분할 화면으로 함께 열린 상대 세션 제목 (접근성 이름에만 쓴다) */
  linkedTo?: string;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const timeAgo = useCompactTimeAgo(agent.lastUserMessageAt);
  const hideSession = useRecentSessionsStore((state) => state.hideSession);
  const handleHide = useCallback(() => {
    if (agent.lastUserMessageAt) {
      hideSession(agent.serverId, agent.id, agent.lastUserMessageAt.getTime());
    }
  }, [agent.serverId, agent.id, agent.lastUserMessageAt, hideSession]);
  const bucket = deriveSidebarStateBucket({
    status: agent.status,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason,
    pendingPermissionCount: agent.pendingPermissions.length,
  });
  const placement =
    agent.projectPlacement?.workspaceName || agent.projectPlacement?.projectName || "";
  const handlePress = useCallback(() => {
    // 이미 열린 세션은 포커스가 바뀌지 않아도 직접 선택한 순간 완료를 확인한다.
    if (bucket === "attention") {
      const client = getHostRuntimeStore().getClient(agent.serverId);
      void client?.clearAgentAttention(agent.id).catch((error) => {
        console.error("Failed to clear recent session attention", error);
      });
    }
    onBeforeNavigate?.();
    // 분할 화면에서도 어느 칸에 열렸는지 보이도록 그 칸을 잠깐 강조한다.
    requestSessionReveal(agent.serverId, agent.id);
    navigateToAgent({
      serverId: agent.serverId,
      agentId: agent.id,
      workspaceId: agent.workspaceId,
    });
  }, [agent.id, agent.serverId, agent.workspaceId, bucket, onBeforeNavigate]);
  const style = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (hovered || pressed) && styles.rowActive,
    ],
    [],
  );
  const title = agent.title || t("agentList.fallbackTitle");
  return (
    <View style={styles.rowContainer}>
      <Pressable
        style={style}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={
          linkedTo
            ? `${title}, ${t("sidebar.recentSessions.splitLinked", { title: linkedTo })}`
            : undefined
        }
        testID={`sidebar-recent-session-${agent.serverId}-${agent.id}`}
      >
        <View style={styles.dotSlot}>
          {/* 확인한 완료(done)는 체크 없이 빈 슬롯으로 둔다 */}
          {bucket === "done" ? null : (
            <WorkspaceStatusIndicator bucket={bucket} workspaceKind="directory" />
          )}
        </View>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {placement ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {placement}
          </Text>
        ) : null}
        <Text style={styles.rowTime}>{timeAgo}</Text>
      </Pressable>
      <Pressable
        style={styles.hideButton}
        onPress={handleHide}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.recentSessions.hide", { title })}
        testID={`sidebar-recent-hide-${agent.serverId}-${agent.id}`}
      >
        <Text style={styles.hideIcon}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    paddingBottom: theme.spacing[2],
    marginBottom: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  windows: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  windowOption: {
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.md,
  },
  windowOptionActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  windowLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  windowLabelSelected: {
    color: theme.colors.foreground,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  // 분할 묶음 박스: 실행 중 점과 같은 파란색을 옅게 깔고 테두리·왼쪽 강조선으로 묶는다.
  splitBox: {
    position: "relative",
    marginVertical: 2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  splitTint: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? theme.colors.accent,
    opacity: 0.07,
  },
  splitBar: {
    position: "absolute",
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: 2,
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? theme.colors.accent,
  },
  splitDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderStyle: "dashed",
  },
  // 터치 영역 44 기준 약 6행
  rows: {
    flexGrow: 0,
    maxHeight: 264,
  },
  row: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 44,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  hideButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  hideIcon: {
    color: theme.colors.foregroundMuted,
    fontSize: 22,
  },
  dotSlot: {
    width: theme.iconSize.md,
    alignItems: "center",
  },
  rowTitle: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowMeta: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowTime: {
    marginLeft: "auto",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
