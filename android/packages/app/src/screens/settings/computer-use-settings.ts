import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";

type ComputerBridgeState = "connected" | "missing" | "expired" | "invalid" | "stale";
interface ComputerUseStatus {
  enabled: boolean;
  bridge: ComputerBridgeState;
  display: boolean;
  mixdogVersion: string;
}

const BRIDGE_PROBLEMS: Record<Exclude<ComputerBridgeState, "connected">, string> = {
  missing: "앱이 실행 중이 아니거나 앱의 Computer Use가 꺼져 있어요.",
  expired: "앱이 5분 넘게 응답하지 않아요.",
  stale: "연결 정보를 남긴 앱이 종료됐어요.",
  invalid: "앱의 연결 정보를 읽을 수 없어요.",
};

// 호스트 응답에서 토글·연결 상태만 검증해 꺼낸다. 형식이 다르면 현재 설정을 모르는 것으로 처리한다.
function parseComputerUse(result: unknown): ComputerUseStatus {
  const value = (result as { computerUse?: Partial<ComputerUseStatus> } | null)?.computerUse;
  if (
    !value ||
    typeof value.enabled !== "boolean" ||
    typeof value.display !== "boolean" ||
    typeof value.mixdogVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(value.mixdogVersion) ||
    !(
      value.bridge === "connected" ||
      (typeof value.bridge === "string" && Object.hasOwn(BRIDGE_PROBLEMS, value.bridge))
    )
  ) {
    throw new Error("Invalid computer use response");
  }
  return value as ComputerUseStatus;
}

// 켠 상태에서 연결이 안 되면 설치·실행 순서를 안내한다.
function statusLines(status: ComputerUseStatus): string[] {
  if (!status.enabled) return [];
  const lines: string[] = [];
  if (!status.display) {
    lines.push(
      "그래픽 세션을 찾지 못했어요. 이 호스트 PC의 데스크톱에 같은 사용자로 로그인하고 mixdog 앱을 실행해 주세요. 화면 없는 서버에서는 쓸 수 없어요.",
    );
  }
  if (status.bridge === "connected") {
    lines.push(
      "mixdog 앱의 연결 정보를 확인했어요. 화면 조작 권한과 추가 요구사항은 앱의 Computer Use 설정에서 확인해 주세요.",
    );
    return lines;
  }
  return [
    ...lines,
    `mixdog 데스크톱 앱과 연결되지 않았어요. ${BRIDGE_PROBLEMS[status.bridge]}`,
    `1. 이 호스트 PC에 PaseoDog 런타임과 같은 버전인 mixdog 데스크톱 앱 ${status.mixdogVersion}을 설치해요. npm CLI만 설치하면 안 돼요.`,
    "2. 앱을 실행하고 앱 설정에서 Computer Use를 켜요.",
    "3. 아래 상태 새로고침으로 연결을 확인해요. 연결된 뒤 새로 시작하는 세션부터 쓸 수 있어요.",
  ];
}

// 도구 화면에서 호스트 PC 화면 조작(Computer Use)을 켜고 끄며 mixdog 앱 연결 상태를 보여준다.
export function ComputerUseSettings({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);

  const request = useCallback(
    async (enabled?: boolean) => {
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
          enabled === undefined ? { action: "computerUse" } : { action: "computerUse", enabled },
        );
        if (current !== generation.current) return;
        const next = parseComputerUse(result);
        setStatus(next);
        if (enabled !== undefined) {
          setMessage(
            next.enabled
              ? "켰어요. 새로 시작하거나 다시 연 세션부터 적용돼요."
              : "껐어요. 기존 세션도 이후 컴퓨터 도구 호출은 차단돼요.",
          );
        }
      } catch {
        if (current !== generation.current) return;
        setStatus(null);
        setError(
          "컴퓨터 사용 설정을 확인하지 못했어요. 새로고침으로 확인해 주세요. 저장 요청은 자동 재전송하지 않아요.",
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
    setStatus(null);
    setBusy(false);
    setMessage("");
    setError("");
    void request();
    return invalidate;
  }, [invalidate, request, serverId]);

  const hint = (text: string, key?: string) =>
    createElement(Text, { key, style: settingsStyles.rowHint }, text);
  return createElement(
    View,
    { style: { gap: 12 } },
    createElement(Text, { style: settingsStyles.rowTitle }, "컴퓨터 사용 (Computer Use)"),
    createElement(
      View,
      { style: settingsStyles.card },
      createElement(
        View,
        { style: settingsStyles.row },
        createElement(
          View,
          { style: settingsStyles.rowContent },
          createElement(Text, { style: settingsStyles.rowTitle }, "컴퓨터 사용"),
          hint("mixdog 데스크톱 앱을 통해 이 호스트 PC의 화면을 보고 마우스·키보드를 조작해요."),
        ),
        createElement(Switch, {
          accessibilityLabel: "컴퓨터 사용",
          disabled: !connected || busy || !status,
          value: status?.enabled ?? false,
          onValueChange: (value: boolean) => {
            if (connected && !busy && status) void request(value);
          },
        }),
      ),
    ),
    hint(
      "기본은 꺼짐이에요. Build 모드에서는 화면 조작마다 승인을 묻고, Review 모드에서는 쓸 수 없어요. Bypass 모드에서는 승인 없이 바로 조작하니 주의해 주세요.",
    ),
    hint(
      "mixdog 앱을 계속 켜 둬야 해요. 이미 실행 중인 조작은 토글로 취소되지 않으니 긴급 중지는 mixdog 앱에서 해 주세요.",
    ),
    ...(status ? statusLines(status).map((line, index) => hint(line, `status:${index}`)) : []),
    status?.enabled
      ? createElement(
          Pressable,
          {
            accessibilityRole: "link",
            accessibilityLabel: "mixdog 데스크톱 앱 다운로드",
            onPress: () => {
              void openExternalUrl(
                `https://github.com/tribgames/mixdog/releases/tag/v${status.mixdogVersion}`,
              ).catch(() => setError("다운로드 페이지를 열지 못했어요."));
            },
            style: settingsStyles.row,
          },
          createElement(
            Text,
            { style: settingsStyles.rowTitle },
            `mixdog ${status.mixdogVersion} 다운로드`,
          ),
        )
      : null,
    !connected ? hint("호스트 연결 안 됨") : null,
    !status && !error ? hint("현재 설정 미확인") : null,
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
        accessibilityLabel: "컴퓨터 사용 상태 새로고침",
        disabled: !connected || busy,
        onPress: () => {
          void request();
        },
        style: settingsStyles.row,
      },
      createElement(Text, { style: settingsStyles.rowTitle }, busy ? "확인 중…" : "상태 새로고침"),
    ),
  );
}
