import { useEffect, useState } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DONUT_SIZE,
  DONUT_STROKE,
  donutArcRotations,
  usageCountdownText,
  usageTooltipText,
} from "./donut-model";
import type { PinnedUsageSource, PinnedUsageWindow } from "./pinned";
import { UsageSourceIcon } from "./source-icon";
import type { UsageTone } from "./types";

// 호 색 선택 (단계 -> 호스트 상태 색, 막대 게이지와 같은 기준)
function arcToneStyle(tone: UsageTone) {
  switch (tone) {
    case "ok":
      return styles.arcOk;
    case "warning":
      return styles.arcWarning;
    case "danger":
      return styles.arcDanger;
    default:
      return styles.arcDefault;
  }
}

function triggerStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return hovered ? [styles.trigger, styles.triggerHovered] : styles.trigger;
}

// 창 하나의 도넛 (사용률 링 -> 안쪽 공급자 아이콘·짧은 이름 -> 아래 초기화 카운트다운)
function UsageDonut({
  icon,
  window,
  now,
}: {
  icon: string | null;
  window: PinnedUsageWindow;
  now: number;
}) {
  const rotation = donutArcRotations(window.percent);
  const tone = arcToneStyle(window.tone);
  return (
    <View style={styles.cell} testID="sidebar-usage-pinned-window">
      <View style={styles.ring}>
        <View style={styles.track} />
        {rotation.right === null ? null : (
          <View style={styles.halfRight}>
            <View
              style={[
                styles.arc,
                styles.arcInRight,
                tone,
                { transform: [{ rotate: `${rotation.right}deg` }] },
              ]}
            />
          </View>
        )}
        {rotation.left === null ? null : (
          <View style={styles.halfLeft}>
            <View
              style={[
                styles.arc,
                styles.arcInLeft,
                tone,
                { transform: [{ rotate: `${rotation.left}deg` }] },
              ]}
            />
          </View>
        )}
        <UsageSourceIcon svg={icon} size={12} />
        {window.shortLabel === "" ? null : (
          <Text style={styles.label} numberOfLines={1}>
            {window.shortLabel}
          </Text>
        )}
      </View>
      <Text style={styles.countdown} numberOfLines={1}>
        {usageCountdownText(window.resetsAt, now)}
      </Text>
    </View>
  );
}

/** PaseoDog: the sidebar summary as one ring per pinned window, chosen in the usage options. */
// 도넛 요약 줄 (요약 원본 -> 가운데 정렬 창별 도넛·호버 사용량, 30초마다 카운트다운 갱신)
export function DonutUsageTrigger({
  accessibilityLabel,
  sources,
  onPress,
}: {
  accessibilityLabel: string;
  sources: readonly PinnedUsageSource[];
  onPress: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={triggerStyle}
        testID="sidebar-usage"
      >
        {sources.flatMap((source) =>
          source.windows.map((window) => (
            <UsageDonut key={window.key} icon={source.icon} window={window} now={now} />
          )),
        )}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{usageTooltipText(sources)}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "center",
    columnGap: theme.spacing[4],
    rowGap: theme.spacing[0.5],
    paddingVertical: theme.spacing[0.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  cell: {
    alignItems: "center",
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
  ring: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    position: "absolute",
    top: 0,
    left: 0,
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    borderRadius: DONUT_SIZE / 2,
    borderWidth: DONUT_STROKE,
    borderColor: theme.colors.surface3,
  },
  halfRight: {
    position: "absolute",
    top: 0,
    left: DONUT_SIZE / 2,
    width: DONUT_SIZE / 2,
    height: DONUT_SIZE,
    overflow: "hidden",
  },
  halfLeft: {
    position: "absolute",
    top: 0,
    left: 0,
    width: DONUT_SIZE / 2,
    height: DONUT_SIZE,
    overflow: "hidden",
  },
  arc: {
    position: "absolute",
    top: 0,
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    borderRadius: DONUT_SIZE / 2,
    borderWidth: DONUT_STROKE,
    borderColor: "transparent",
  },
  arcInRight: {
    left: -DONUT_SIZE / 2,
  },
  arcInLeft: {
    left: 0,
  },
  arcDefault: {
    borderLeftColor: theme.colors.foregroundMuted,
    borderBottomColor: theme.colors.foregroundMuted,
  },
  arcOk: {
    borderLeftColor: theme.colors.statusSuccess,
    borderBottomColor: theme.colors.statusSuccess,
  },
  arcWarning: {
    borderLeftColor: theme.colors.statusWarning,
    borderBottomColor: theme.colors.statusWarning,
  },
  arcDanger: {
    borderLeftColor: theme.colors.statusDanger,
    borderBottomColor: theme.colors.statusDanger,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: 8,
    lineHeight: 9,
  },
  countdown: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 14,
    fontVariant: ["tabular-nums"],
  },
}));
