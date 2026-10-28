import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

interface SpeechModel {
  id: string;
  label: string;
  description: string;
  warning: string;
}
interface SpeechSnapshot {
  model: string | null;
  revision: string;
  blocked: boolean;
  models: SpeechModel[];
}

function isSpeechSnapshot(value: unknown): value is SpeechSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as SpeechSnapshot;
  return (
    (data.model === null || typeof data.model === "string") &&
    typeof data.revision === "string" &&
    /^[a-f0-9]{64}$/.test(data.revision) &&
    typeof data.blocked === "boolean" &&
    Array.isArray(data.models) &&
    data.models.length > 0 &&
    data.models.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        typeof item.description === "string" &&
        typeof item.warning === "string",
    )
  );
}

// 호버·키보드 포커스·터치 모두 같은 연산 경고를 보여 준다.
function SpeechWarning({ model }: { model: SpeechModel }) {
  const [open, setOpen] = useState(false);
  if (!model.warning) return null;
  return createElement(
    View,
    { style: { paddingHorizontal: 16, paddingBottom: 8 } },
    createElement(
      Pressable,
      {
        accessibilityRole: "button",
        accessibilityLabel: `${model.label} 연산 경고`,
        accessibilityHint: model.warning,
        accessibilityState: { expanded: open },
        onHoverIn: () => setOpen(true),
        onHoverOut: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
        onPress: () => setOpen((value) => !value),
      },
      createElement(Text, { style: settingsStyles.rowHint }, "연산 주의 ⓘ"),
    ),
    open
      ? createElement(
          Text,
          { style: settingsStyles.rowHint, accessibilityLiveRegion: "polite" },
          model.warning,
        )
      : null,
  );
}

export function SpeechSettings({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [snapshot, setSnapshot] = useState<SpeechSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  const request = useCallback(
    async (model?: string, revision?: string) => {
      if (!client || !connected || locked.current) return;
      const current = generation.current;
      locked.current = true;
      setBusy(true);
      setError("");
      setMessage("");
      try {
        const result = await client.invokePluginRpc(
          "paseodog-provider",
          "speech-settings",
          model === undefined ? { action: "read" } : { action: "write", model, revision },
        );
        if (current !== generation.current) return;
        if (!isSpeechSnapshot(result)) throw new Error("Invalid speech settings response");
        setSnapshot(result);
        if (model !== undefined) {
          setMessage(
            "저장했어요. 실행 중 모델은 바뀌지 않아요. 호스트를 안전하게 재시작한 뒤 적용되며, 없는 모델은 그때 다운로드해요.",
          );
        }
      } catch {
        if (current !== generation.current) return;
        setSnapshot(null);
        setError(
          "결과를 확인하지 못했어요. 자동 재전송하지 않아요. 새로고침 후 다시 선택해 주세요.",
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
    setSnapshot(null);
    setBusy(false);
    setMessage("");
    setError("");
    void request();
    return invalidate;
  }, [invalidate, request, serverId]);
  const disabled = !connected || busy || !snapshot || snapshot.blocked;
  return createElement(
    View,
    { style: { gap: 12 } },
    createElement(Text, { style: settingsStyles.rowTitle }, "한국어 음성인식"),
    createElement(
      Text,
      { style: settingsStyles.rowHint },
      "추가 API 과금 없는 로컬 모델만 제공해요. 받아쓰기·음성 모드 인식에 함께 적용해요. 현재 실행 방식은 호스트 PC의 CPU예요.",
    ),
    createElement(
      Text,
      { style: settingsStyles.rowHint },
      snapshot
        ? "체크 표시는 저장된 선택이며 실행 중 모델·다운로드 완료를 뜻하지 않아요."
        : "설정을 확인해 주세요.",
    ),
    snapshot?.blocked
      ? createElement(
          Text,
          { style: settingsStyles.rowError },
          "환경변수에서 모델을 지정하고 있어 여기서는 변경할 수 없어요.",
        )
      : null,
    snapshot && snapshot.model === null
      ? createElement(
          Text,
          { style: settingsStyles.rowHint },
          "기존 설정이 후보 밖이거나 두 음성 기능의 모델이 서로 달라요.",
        )
      : null,
    createElement(
      View,
      { style: settingsStyles.card },
      ...(snapshot?.models ?? []).map((model) =>
        createElement(
          View,
          { key: model.id },
          createElement(
            Pressable,
            {
              style: settingsStyles.row,
              accessibilityRole: "radio",
              accessibilityLabel: model.label,
              accessibilityState: { checked: snapshot?.model === model.id, disabled },
              disabled,
              onPress: () => {
                if (!disabled && snapshot) void request(model.id, snapshot.revision);
              },
            },
            createElement(
              View,
              { style: settingsStyles.rowContent },
              createElement(Text, { style: settingsStyles.rowTitle }, model.label),
              createElement(Text, { style: settingsStyles.rowHint }, model.description),
            ),
            createElement(
              Text,
              { style: settingsStyles.rowHint },
              snapshot?.model === model.id ? "선택됨" : "선택",
            ),
          ),
          createElement(SpeechWarning, { model }),
        ),
      ),
    ),
    message
      ? createElement(
          Text,
          { style: settingsStyles.rowHint, accessibilityLiveRegion: "polite" },
          message,
        )
      : null,
    error
      ? createElement(
          Text,
          { style: settingsStyles.rowError, accessibilityLiveRegion: "polite" },
          error,
        )
      : null,
    createElement(
      Pressable,
      {
        accessibilityRole: "button",
        accessibilityLabel: "음성인식 설정 새로고침",
        style: settingsStyles.row,
        disabled: !connected || busy,
        onPress: () => {
          void request();
        },
      },
      createElement(
        Text,
        { style: settingsStyles.rowTitle },
        busy ? "확인 중…" : "음성인식 설정 새로고침",
      ),
    ),
  );
}
