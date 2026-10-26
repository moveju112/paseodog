import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

const DEFAULT_TURN_MINUTES = 120;
const MAX_TURN_MINUTES = Math.floor(2147483647 / 60000);

// 기본 워크플로우 화면에서 호스트의 다음 명령 실행 제한을 설정한다.
export function TurnDurationSettings({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [minutes, setMinutes] = useState(String(DEFAULT_TURN_MINUTES));
  const [revision, setRevision] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);

  const request = useCallback(
    async (value?: number) => {
      if (!client || !connected || locked.current) return;
      const current = generation.current;
      locked.current = true;
      setBusy(true);
      setMessage("");
      setError("");
      try {
        const result = await client.invokePluginRpc(
          "paseodog-provider",
          "engine-controls",
          value === undefined
            ? { action: "read" }
            : { action: "turnDuration", maxTurnMinutes: value },
        );
        if (current !== generation.current) return;
        if (
          !result ||
          typeof result !== "object" ||
          !("maxTurnMinutes" in result) ||
          typeof result.maxTurnMinutes !== "number" ||
          !Number.isInteger(result.maxTurnMinutes) ||
          result.maxTurnMinutes < 1 ||
          result.maxTurnMinutes > MAX_TURN_MINUTES
        ) {
          throw new Error("Invalid turn duration response");
        }
        setMinutes(String(result.maxTurnMinutes));
        setRevision((previousRevision) => previousRevision + 1);
        setConfirmed(true);
        if (value !== undefined) setMessage("저장했어요. 다음 명령부터 적용돼요.");
      } catch {
        if (current !== generation.current) return;
        setConfirmed(false);
        setError(
          "실행 시간 설정을 확인하지 못했어요. 새로고침으로 확인해 주세요. 저장 요청은 자동 재전송하지 않아요.",
        );
      } finally {
        if (current === generation.current) {
          locked.current = false;
          setBusy(false);
        }
      }
    },
    [client, connected],
  );

  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    invalidate();
    locked.current = false;
    setMinutes(String(DEFAULT_TURN_MINUTES));
    setRevision((previousRevision) => previousRevision + 1);
    setConfirmed(false);
    setBusy(false);
    setMessage("");
    setError("");
    void request();
    return invalidate;
  }, [invalidate, request, serverId]);

  const disabled = !connected || busy || !confirmed;
  const valid =
    /^\d+$/.test(minutes) && Number(minutes) >= 1 && Number(minutes) <= MAX_TURN_MINUTES;
  return createElement(
    View,
    { style: { gap: 12 } },
    createElement(Text, { style: settingsStyles.rowTitle }, "명령 최대 실행 시간"),
    createElement(
      View,
      { style: settingsStyles.card },
      createElement(
        View,
        { style: settingsStyles.row },
        createElement(
          View,
          { style: settingsStyles.rowContent },
          createElement(Text, { style: settingsStyles.rowTitle }, "실행 시간 (분)"),
          createElement(Text, { style: settingsStyles.rowHint }, "기본 120분 (2시간)"),
        ),
        createElement(AdaptiveTextInput, {
          accessibilityLabel: "명령 최대 실행 시간 (분)",
          initialValue: minutes,
          resetKey: revision,
          onChangeText: setMinutes,
          editable: !disabled,
          keyboardType: "number-pad",
          style: [settingsStyles.rowTitle, { minWidth: 80, minHeight: 48, textAlign: "right" }],
        }),
      ),
      createElement(
        Pressable,
        {
          accessibilityRole: "button",
          accessibilityLabel: "실행 시간 저장",
          disabled: disabled || !valid,
          onPress: () => {
            if (!disabled && valid) void request(Number(minutes));
          },
          style: settingsStyles.row,
        },
        createElement(Text, { style: settingsStyles.rowTitle }, "실행 시간 저장"),
      ),
    ),
    createElement(
      Text,
      { style: settingsStyles.rowHint },
      `1~${MAX_TURN_MINUTES}분. 이 호스트의 다음 명령부터 적용되며 실행 중인 명령은 바뀌지 않아요.`,
    ),
    !connected ? createElement(Text, { style: settingsStyles.rowHint }, "호스트 연결 안 됨") : null,
    !confirmed ? createElement(Text, { style: settingsStyles.rowHint }, "현재 설정 미확인") : null,
    message
      ? createElement(
          Text,
          { accessibilityLiveRegion: "polite", style: settingsStyles.rowHint },
          message,
        )
      : null,
    error
      ? createElement(
          Text,
          { accessibilityLiveRegion: "polite", style: settingsStyles.rowError },
          error,
        )
      : null,
    createElement(
      Pressable,
      {
        accessibilityRole: "button",
        accessibilityLabel: "실행 시간 설정 새로고침",
        disabled: !connected || busy,
        onPress: () => {
          void request();
        },
        style: settingsStyles.row,
      },
      createElement(
        Text,
        { style: settingsStyles.rowTitle },
        busy ? "확인 중…" : "실행 시간 설정 새로고침",
      ),
    ),
  );
}
