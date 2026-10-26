import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

// 호스트 전환·재연결 이후 이전 응답이 새 호스트의 설정을 덮어쓰지 않게 한다.
export function AgentMessageSettings({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  const request = useCallback(async (value?: boolean) => {
    if (!client || !connected || locked.current) return;
    const current = generation.current;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await client.invokePluginRpc("paseodog-provider", "agent-message-policy",
        value === undefined ? { action: "read" } : { action: "write", allowUnrelatedSessions: value });
      if (current !== generation.current) return;
      if (!result || typeof result !== "object" ||
          !("allowUnrelatedSessions" in result) || typeof result.allowUnrelatedSessions !== "boolean") {
        throw new Error("Invalid message policy response");
      }
      setAllowed(result.allowUnrelatedSessions);
    } catch {
      if (current !== generation.current) return;
      setAllowed(null);
      setError("설정 결과를 확인하지 못했어요. 호스트 업데이트와 연결을 확인한 뒤 새로고침해 주세요.");
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }, [client, connected]);

  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    invalidate();
    locked.current = false;
    setAllowed(null);
    setBusy(false);
    setError("");
    void request();
    return invalidate;
  }, [invalidate, request, serverId]);

  const disabled = !connected || busy || allowed === null;
  let status = "미확인";
  if (!connected) status = "연결 안 됨";
  else if (allowed !== null) status = allowed ? "켜짐" : "꺼짐";
  return createElement(View, { style: { gap: 12 } },
    createElement(Text, { style: settingsStyles.rowTitle }, "세션 간 메시지"),
    createElement(View, { style: settingsStyles.card },
      createElement(Pressable, {
        style: settingsStyles.row,
        accessibilityRole: "switch",
        accessibilityLabel: "무관한 세션 간 메시지 허용",
        accessibilityState: { checked: allowed === true, disabled },
        disabled,
        onPress: () => { if (!disabled && allowed !== null) void request(!allowed); },
      },
      createElement(View, { style: settingsStyles.rowContent },
        createElement(Text, { style: settingsStyles.rowTitle }, "무관한 세션 간 메시지 허용"),
        createElement(Text, { style: settingsStyles.rowHint },
          "꺼도 직접 부모·자식 에이전트 통신과 자동 오케스트레이터는 유지돼요.")),
      createElement(Text, { style: settingsStyles.rowHint }, status))),
    createElement(Text, { style: settingsStyles.rowHint },
      "다음 메시지부터 적용돼요. 이미 전달된 메시지와 진행 중인 작업은 취소하지 않아요."),
    error ? createElement(Text, { accessibilityLiveRegion: "polite", style: settingsStyles.rowError }, error) : null,
    createElement(Pressable, {
      accessibilityRole: "button", accessibilityLabel: "세션 메시지 설정 새로고침",
      disabled: !connected || busy, onPress: () => { void request(); },
      style: settingsStyles.row,
    }, createElement(Text, { style: settingsStyles.rowTitle }, busy ? "확인 중…" : "세션 메시지 설정 새로고침")));
}
