import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { Columns2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { WorkspaceStatusIndicator } from "@/components/sidebar/sidebar-workspace-row-content";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useRecentSessionsStore } from "@/stores/recent-sessions-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { requestSessionReveal } from "@/stores/session-reveal-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  groupRecentSessionsBySplit,
  RECENT_SESSIONS_WINDOWS,
  selectRecentSessions,
  selectSplitSessionGroups,
  type RecentSessionsWindow,
} from "@/utils/recent-sessions";

const ThemedColumns2 = withUnistyles(Columns2);
const splitIconColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";

const WINDOW_LABEL_KEYS = {
  "15m": "sidebar.recentSessions.windows.fifteenMinutes",
  "1h": "sidebar.recentSessions.windows.oneHour",
  today: "sidebar.recentSessions.windows.today",
} as const satisfies Record<RecentSessionsWindow, string>;

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
  const window = useRecentSessionsStore((state) => state.window);
  const setWindow = useRecentSessionsStore((state) => state.setWindow);
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
      groupRecentSessionsBySplit(selectRecentSessions(agentsByServer, window, now), splitGroups),
    [agentsByServer, window, now, splitGroups],
  );

  return (
    <View style={styles.section} testID="sidebar-recent-sessions">
      <View style={styles.header}>
        <Text style={styles.title}>{t("sidebar.recentSessions.title")}</Text>
        <View style={styles.windows}>
          {RECENT_SESSIONS_WINDOWS.map((option) => (
            <RecentWindowOption
              key={option}
              label={t(WINDOW_LABEL_KEYS[option])}
              accessibilityLabel={t("sidebar.recentSessions.windowAccessibility", {
                window: t(WINDOW_LABEL_KEYS[option]),
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
          {sessions.map(({ agent, linked }) => (
            <View key={`${agent.serverId}:${agent.id}`}>
              <RecentSessionRow
                agent={agent}
                split={linked.length > 0}
                onBeforeNavigate={onBeforeNavigate}
              />
              {linked.length > 0 ? (
                <View style={styles.linkedGroup} testID="sidebar-recent-split-group">
                  {linked.map((linkedAgent) => (
                    <RecentSessionRow
                      key={`${linkedAgent.serverId}:${linkedAgent.id}`}
                      agent={linkedAgent}
                      linkedTo={agent.title || t("agentList.fallbackTitle")}
                      onBeforeNavigate={onBeforeNavigate}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
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

// 최근 세션 행 (상태 링·체크·제목·분할 표시·경과 시간 -> 누르면 세션 이동)
function RecentSessionRow({
  agent,
  split = false,
  linkedTo,
  onBeforeNavigate,
}: {
  agent: Agent;
  /** 분할 화면으로 함께 열린 세션을 아래에 붙인 대표 행 */
  split?: boolean;
  /** 분할 화면으로 붙은 행이면 대표 세션 제목 */
  linkedTo?: string;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const timeAgo = useCompactTimeAgo(agent.lastUserMessageAt);
  const bucket = deriveSidebarStateBucket({
    status: agent.status,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason,
    pendingPermissionCount: agent.pendingPermissions.length,
  });
  const placement =
    agent.projectPlacement?.workspaceName || agent.projectPlacement?.projectName || "";
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    // 분할 화면에서도 어느 칸에 열렸는지 보이도록 그 칸을 잠깐 강조한다.
    requestSessionReveal(agent.serverId, agent.id);
    navigateToAgent({
      serverId: agent.serverId,
      agentId: agent.id,
      workspaceId: agent.workspaceId,
    });
  }, [agent.id, agent.serverId, agent.workspaceId, onBeforeNavigate]);
  const style = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (hovered || pressed) && styles.rowActive,
    ],
    [],
  );
  const title = agent.title || t("agentList.fallbackTitle");
  return (
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
      {split || linkedTo ? (
        <ThemedColumns2
          size={12}
          uniProps={splitIconColorMapping}
          testID="sidebar-recent-split-icon"
        />
      ) : null}
      {placement ? (
        <Text style={styles.rowMeta} numberOfLines={1}>
          {placement}
        </Text>
      ) : null}
      <Text style={styles.rowTime}>{timeAgo}</Text>
    </Pressable>
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
  // 분할 화면으로 붙은 행: 대표 행 상태 점 아래에서 이어지는 세로선으로 연결을 표시한다.
  linkedGroup: {
    marginLeft: theme.spacing[2] + theme.iconSize.md / 2,
    paddingLeft: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  // 행 높이 30 기준 약 6행
  rows: {
    flexGrow: 0,
    maxHeight: 186,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 30,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
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
