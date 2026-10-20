import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Users } from "lucide-react-native";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { usePaseodogCollaborationHost } from "@/hooks/use-paseodog-host-control";
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

const OCHE_OPTIONS: ComboboxOption[] = [{ id: "swarm", label: "에이전트 협업" }];
const OCHE_SCOPE = "이 호스트 전체에 적용 · 열린 세션은 다음 요청부터 · 도구 승인 설정은 그대로";

// OCHE: 모드·추론과 같은 트리거·Combobox로 메뉴만 열고, 메뉴 안 스위치로만 호스트 전체 협업을 전환한다.
// 권한 모드·에이전트 활성화·세션 기록은 건드리지 않으며 실패 후 다음 누름은 조회만 한다.
export function PaseodogCollaboration({
  provider,
  serverId,
  disabled = false,
  surface = "toolbar",
}: CollaborationProps) {
  const { presentation } = useComposerControlLayout();
  const { control, snapshot, connected } = usePaseodogCollaborationHost(
    serverId,
    provider === "paseodog",
  );
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const mode = snapshot.error ? null : snapshot.value?.orchestration;
  const enabled = mode === "swarm";
  const triggerBlocked = disabled || !connected;
  const switchBlocked = triggerBlocked || snapshot.busy;
  const status = collaborationStatus(mode, snapshot.busy, snapshot.error);
  const muted = switchBlocked || !mode;
  const accessibilityState = useMemo(
    () => ({ expanded: open, disabled: triggerBlocked }),
    [open, triggerBlocked],
  );
  // 트리거는 메뉴만 열고 닫으며 호스트 설정을 바꾸지 않는다.
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  // 메뉴 안 스위치: 결과를 모르면 조회만 하고 저장 중·비활성에는 추가 요청을 보내지 않는다.
  const handleToggle = useCallback(() => {
    if (!control || switchBlocked) return;
    if (!mode) void control.refresh();
    else void control.request({ action: "orchestration", mode: enabled ? "none" : "swarm" });
  }, [control, enabled, mode, switchBlocked]);
  const switchTrack = useMemo(
    () => <CollaborationSwitchTrack enabled={enabled} muted={muted} />,
    [enabled, muted],
  );
  // 스위치 행은 메뉴를 닫지 않는 Combobox 선택 경로(keepOpenOnSelect)로만 누름을 전달한다.
  const renderOption = useCallback(
    ({
      option,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      active: boolean;
      onPress: () => void;
    }): ReactElement => (
      <ComboboxItem
        label={option.label}
        description={status}
        selected={enabled}
        active={active}
        disabled={switchBlocked}
        trailingSlot={switchTrack}
        onPress={onPress}
        accessibilityLabel={`에이전트 협업 스위치 (호스트 전체): ${status}`}
        testID="paseodog-oche-switch"
      />
    ),
    [enabled, status, switchBlocked, switchTrack],
  );
  const hint = snapshot.error || OCHE_SCOPE;
  const stickyHeader = useMemo(
    () => <Text style={snapshot.error ? styles.error : styles.scope}>{hint}</Text>,
    [hint, snapshot.error],
  );
  if (provider !== "paseodog" || !control) return null;
  let iconMapping = mutedIconMapping;
  if (enabled && !snapshot.busy) iconMapping = accentIconMapping;
  if (snapshot.error) iconMapping = destructiveIconMapping;
  return (
    <View style={styles.container}>
      <ThemedAgentControlTrigger
        ref={anchorRef}
        icon={Users}
        uniProps={iconMapping}
        surface={surface}
        label="OCHE"
        value={surface === "sheet" ? status : "OCHE"}
        showToolbarLabel={presentation.showModeLabel}
        showCaret={surface === "toolbar" && presentation.showCarets}
        open={open}
        accessibilityLabel={`OCHE 오케스트레이션: ${status}`}
        accessibilityHint={hint}
        accessibilityState={accessibilityState}
        disabled={triggerBlocked}
        testID="paseodog-oche-trigger"
        onPress={handlePress}
      />
      <Combobox
        options={OCHE_OPTIONS}
        value={enabled ? "swarm" : ""}
        onSelect={handleToggle}
        searchable={false}
        title="OCHE"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        keepOpenOnSelect
        desktopPlacement="top-start"
        desktopMinWidth={280}
        stickyHeader={stickyHeader}
        renderOption={renderOption}
      />
      {!!snapshot.error && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {snapshot.error}
        </Text>
      )}
    </View>
  );
}

// 호스트 확인 상태를 트리거·메뉴 공통 문구로 바꾼다 (오류 > 확인 중 > 켜짐/꺼짐).
function collaborationStatus(mode: string | null | undefined, busy: boolean, error: string) {
  if (error) return "확인 필요";
  if (busy || !mode) return "확인 중";
  return mode === "swarm" ? "켜짐 · 에이전트 협업" : "꺼짐 · 단독 실행";
}

// 메뉴 행 끝의 스위치 모양 (켜짐은 오른쪽, 확인 전·저장 중은 흐리게).
function CollaborationSwitchTrack({ enabled, muted }: { enabled: boolean; muted: boolean }) {
  return (
    <View
      style={[styles.switchTrack, enabled && styles.switchTrackOn, muted && styles.switchMuted]}
    >
      <View style={styles.switchThumb} />
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
  scope: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  switchTrack: {
    width: 32,
    height: 18,
    borderRadius: 9,
    padding: 2,
    justifyContent: "center",
    alignItems: "flex-start",
    backgroundColor: theme.colors.border,
  },
  switchTrackOn: {
    alignItems: "flex-end",
    backgroundColor: theme.colors.foreground,
  },
  switchMuted: {
    opacity: 0.5,
  },
  switchThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.colors.surface0,
  },
}));
