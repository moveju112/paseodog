import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { clearLocalClientErrorReports } from "@/diagnostics/client-error-runtime";
import { CLIENT_ERROR_RETENTION_DAYS, useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

type LocalClearOutcome = "cleared" | "failed";
type HostClearOutcome = LocalClearOutcome | "unavailable";
type HostClient = ReturnType<typeof useHostRuntimeClient>;

interface ClearResult {
  local: LocalClearOutcome;
  host: HostClearOutcome;
}

export interface ClientErrorReportingSectionProps {
  /** Host whose daemon collector receives and clears this app's diagnostics. */
  serverId: string | null;
}

// 이 앱의 미전송 진단만 삭제 (진행 중 전송 대기 -> 거짓이면 거부)
async function clearLocalReportsOrThrow(): Promise<void> {
  if (!(await clearLocalClientErrorReports())) throw new Error("Local client error clear refused");
}

// 이 앱의 로컬 큐 삭제 결과 (리포터 -> 결과)
async function clearLocalQueue(): Promise<LocalClearOutcome> {
  try {
    await clearLocalReportsOrThrow();
    return "cleared";
  } catch {
    return "failed";
  }
}

// 연결된 데몬 수집기 삭제를 한 번만 요청하고 확인된 응답만 성공으로 본다 (RPC -> 결과)
async function clearHostCollector(
  client: HostClient,
  connected: boolean,
): Promise<HostClearOutcome> {
  if (!client || !connected) return "unavailable";
  try {
    const result: unknown = await client.invokePluginRpc("paseodog-provider", "client-errors", {
      action: "clear",
    });
    const accepted =
      typeof result === "object" && result !== null && "accepted" in result
        ? result.accepted
        : undefined;
    return Number.isInteger(accepted) && Number(accepted) >= 0 ? "cleared" : "failed";
  } catch {
    return "failed";
  }
}

// 앱 오류 보고 설정 (전송 동의·로컬 보관 기간·진단 삭제)
export function ClientErrorReportingSection({ serverId }: ClientErrorReportingSectionProps) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const client = useHostRuntimeClient(serverId ?? "");
  const connected = useHostRuntimeIsConnected(serverId ?? "");
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<ClearResult | null>(null);

  const retentionOptions = useMemo(
    () =>
      CLIENT_ERROR_RETENTION_DAYS.map((days) => ({
        value: String(days),
        label: t(`settings.diagnostics.errorReporting.retention.options.${days}`),
      })),
    [t],
  );

  const changeEnabled = useCallback(
    (clientErrorReportingEnabled: boolean) => void updateSettings({ clientErrorReportingEnabled }),
    [updateSettings],
  );
  const changeRetention = useCallback(
    (value: string) => {
      const days = CLIENT_ERROR_RETENTION_DAYS.find((candidate) => String(candidate) === value);
      if (days !== undefined) void updateSettings({ clientErrorRetentionDays: days });
    },
    [updateSettings],
  );

  // 로컬 큐를 먼저 비운 뒤 연결 데몬에 삭제 RPC를 한 번 보내고, 양쪽 결과를 그대로 보여준다.
  const deleteDiagnostics = useCallback(async () => {
    setDeleting(true);
    setResult(null);
    const local = await clearLocalQueue();
    const host = await clearHostCollector(client, connected);
    setResult({ local, host });
    setDeleting(false);
  }, [client, connected]);
  const handleDelete = useCallback(() => void deleteDiagnostics(), [deleteDiagnostics]);

  const fullyCleared = result?.local === "cleared" && result.host === "cleared";
  const deleteHint = fullyCleared
    ? t("settings.diagnostics.errorReporting.delete.success")
    : t("settings.diagnostics.errorReporting.delete.hint");
  const deleteError =
    result && !fullyCleared
      ? [
          t(`settings.diagnostics.errorReporting.delete.local.${result.local}`),
          t(`settings.diagnostics.errorReporting.delete.host.${result.host}`),
        ].join(" ")
      : undefined;

  return (
    <SettingsSection title={t("settings.diagnostics.errorReporting.title")}>
      <SettingsCard testID="client-error-reporting-card">
        <SettingsSwitch
          label={t("settings.diagnostics.errorReporting.enabled.label")}
          hint={t("settings.diagnostics.errorReporting.enabled.hint")}
          value={settings.clientErrorReportingEnabled}
          onValueChange={changeEnabled}
        />
        <SettingsSelect
          label={t("settings.diagnostics.errorReporting.retention.label")}
          hint={t("settings.diagnostics.errorReporting.retention.hint")}
          value={String(settings.clientErrorRetentionDays)}
          options={retentionOptions}
          onValueChange={changeRetention}
        />
        <SettingsRow
          label={t("settings.diagnostics.errorReporting.delete.label")}
          hint={deleteHint}
          error={deleteError}
          testID="client-error-delete-row"
        >
          <Button
            variant="outline"
            size="sm"
            onPress={handleDelete}
            loading={deleting}
            testID="client-error-delete-button"
          >
            {deleting
              ? t("settings.diagnostics.errorReporting.delete.deleting")
              : t("settings.diagnostics.errorReporting.delete.action")}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
