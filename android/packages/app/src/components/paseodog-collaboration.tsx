import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Zap } from "lucide-react-native";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { getFastControl } from "@/utils/paseodog-fast-control.mjs";
import type { Theme } from "@/styles/theme";

// 아이콘 색만 테마 반응형으로 받도록 트리거 하나만 감싼다 (ref는 그대로 전달).
const ThemedAgentControlTrigger = withUnistyles(AgentControlTrigger);
const mutedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foregroundMuted });
const accentIconMapping = (theme: Theme) => ({ iconColor: theme.colors.accent });
const destructiveIconMapping = (theme: Theme) => ({ iconColor: theme.colors.destructive });

interface CollaborationProps {
  provider: string;
  serverId: string | null;
  disabled?: boolean;
  surface?: "toolbar" | "sheet";
}

export const PaseodogFastScope = createContext<{
  paseodogScope: "live" | "draft";
  agentId?: string;
  selectedModelId?: string;
}>({ paseodogScope: "draft" });

const emptySnapshot = { enabled: null, available: false, busy: false, error: "" };
const getEmptySnapshot = () => emptySnapshot;
const emptySubscribe = () => () => {};

function useFastMode(provider: string, serverId: string | null) {
  const scope = useContext(PaseodogFastScope);
  const client = useHostRuntimeClient(serverId ?? "");
  const connected = useHostRuntimeIsConnected(serverId ?? "");
  const visible = useAppActivelyVisible();
  const control =
    client &&
    serverId &&
    provider === "paseodog" &&
    (scope.paseodogScope === "draft" || scope.agentId)
      ? getFastControl(
          client,
          scope.paseodogScope === "live" ? scope.agentId : null,
          scope.selectedModelId,
        )
      : null;
  const snapshot = useSyncExternalStore(
    control?.subscribe ?? emptySubscribe,
    control?.getSnapshot ?? getEmptySnapshot,
    control?.getSnapshot ?? getEmptySnapshot,
  );
  useEffect(() => {
    if (control && connected && visible) void control.refresh();
  }, [control, connected, visible, scope.selectedModelId]);
  return { control, snapshot, connected, scope };
}

function fastStatus(snapshot: ReturnType<ReturnType<typeof getFastControl>["getSnapshot"]>) {
  if (snapshot.error) return "확인 필요";
  if (snapshot.busy) return "확인 중";
  if (!snapshot.available) return "지원하지 않는 모델";
  return snapshot.enabled ? "켜짐" : "꺼짐";
}

// Fast 토글은 툴바에서는 아이콘, 시트에서는 라벨과 상태가 있는 행으로 표시한다.
export function PaseodogCollaboration({
  provider,
  serverId,
  disabled = false,
  surface = "toolbar",
}: CollaborationProps) {
  const { control, snapshot, connected, scope } = useFastMode(provider, serverId);
  const enabled = snapshot.enabled === true && !snapshot.error;
  const blocked =
    disabled || !connected || snapshot.busy || (!snapshot.error && !snapshot.available);
  const accessibilityState = useMemo(
    () => ({ checked: enabled, disabled: blocked, busy: snapshot.busy }),
    [enabled, blocked, snapshot.busy],
  );
  const handlePress = useCallback(() => {
    if (!blocked) void control?.toggle();
  }, [blocked, control]);
  if (!control) return null;
  const status = fastStatus(snapshot);
  const hint =
    snapshot.error ||
    (scope.paseodogScope === "live"
      ? "이 세션의 다음 요청부터 적용 · 추가 요금이 발생할 수 있어요"
      : "새 세션의 기본값 · 추가 요금이 발생할 수 있어요");
  let iconMapping = mutedIconMapping;
  if (enabled) iconMapping = accentIconMapping;
  if (snapshot.error) iconMapping = destructiveIconMapping;
  return (
    <View style={styles.container}>
      <ThemedAgentControlTrigger
        icon={Zap}
        uniProps={iconMapping}
        surface={surface}
        label="Fast"
        value={status}
        showToolbarLabel={false}
        showCaret={false}
        open={enabled}
        accessibilityRole="switch"
        accessibilityLabel={`Fast mode: ${status}`}
        accessibilityHint={hint}
        accessibilityState={accessibilityState}
        disabled={blocked}
        testID="paseodog-fast-toggle"
        onPress={handlePress}
      />
      {!!snapshot.error && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {snapshot.error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    minWidth: 0,
    flexShrink: 1,
  },
  error: {
    paddingHorizontal: theme.spacing[2],
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
