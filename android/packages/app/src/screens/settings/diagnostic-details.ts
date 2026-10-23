import { createElement, useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/button";
import { useInstalledPlugins } from "@/plugins/registry";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

interface DiagnosticDetailsProps {
  serverId: string | null;
  children: ReactNode;
}

// 상세를 열기 전에는 오디오 테스트와 원본 조회 도구를 노출하지 않는다.
export function DiagnosticDetails({ serverId, children }: DiagnosticDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const plugins = useInstalledPlugins();
  const connected = useHostRuntimeIsConnected(serverId ?? "");
  const available = plugins.some(
    (plugin) =>
      plugin.serverId === serverId &&
      plugin.id === "paseodog-provider" &&
      plugin.surfaces.some((surface) => surface.id === "paseodog-native-config"),
  );
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const openNativeConfig = useCallback(() => {
    if (!serverId) return;
    router.push(
      buildPluginSurfaceRoute(serverId, "paseodog-provider", {
        kind: "surface",
        id: "paseodog-native-config",
      }),
    );
  }, [router, serverId]);

  return createElement(
    View,
    null,
    createElement(
      Button,
      {
        variant: "ghost",
        size: "sm",
        onPress: toggle,
        accessibilityLabel: "진단 상세",
        accessibilityState: { expanded },
      },
      expanded ? "진단 상세 닫기" : "진단 상세",
    ),
    expanded
      ? createElement(
          View,
          null,
          children,
          createElement(
            View,
            { style: settingsStyles.row },
            createElement(
              View,
              { style: settingsStyles.rowContent },
              createElement(Text, { style: settingsStyles.rowTitle }, "원본 스킬·훅 보기"),
              createElement(
                Text,
                { style: settingsStyles.rowHint },
                "선택한 호스트의 Claude Code·Codex 원본 조회 전용 · PaseoDog에 적용되지 않음",
              ),
            ),
            createElement(
              Button,
              {
                variant: "secondary",
                size: "sm",
                onPress: openNativeConfig,
                disabled: !connected || !available,
                accessibilityLabel: "원본 스킬·훅 보기",
              },
              "열기",
            ),
          ),
        )
      : null,
  );
}
