import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import { usePathname } from "expo-router";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { parseServerIdFromPathname } from "@/utils/host-routes";
import { resolveAppVersion } from "@/utils/app-version";
import { ClientErrorReporter, type ClientErrorRpcClient, type ClientErrorSource, type PickerStage } from "./client-errors";
import { installClientErrorHandlers, type ErrorHandlerTarget } from "./client-error-handlers";
import { subscribeDesktopClientErrors } from "./client-error-desktop";

const reporter = new ClientErrorReporter({
    now: Date.now,
    uuid: randomUUID,
    appVersion: resolveAppVersion() ?? "0",
    platform: isElectronRuntime() ? "desktop" : Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
    osVersion: String(Platform.Version),
});

// 명시적 오류와 선택기 단계를 공통 개인정보 제거 경로로 보낸다.
export function captureClientError(error: unknown, source: ClientErrorSource, stage?: PickerStage) {
    reporter.capture(error, source, stage);
}

// 설정 UI에서 로컬 큐와 현재 연결된 호스트의 보고서를 함께 비운다.
export function clearClientErrorReports(serverId: string, client?: ClientErrorRpcClient | null): Promise<boolean> {
    return reporter.clear(serverId, client);
}

// UI가 서버 삭제 RPC를 직접 소유할 때 중복 RPC 없이 로컬 큐만 먼저 비운다.
export function clearLocalClientErrorReports(serverId?: string): Promise<boolean> {
    return reporter.clearLocal(serverId);
}

// 활성 경로의 인증된 연결만 사용하며 설정·연결 변경과 전역 처리기 수명을 동기화한다.
export function ClientErrorReportingRuntime() {
    const pathname = usePathname();
    const activeServerId = useRef<string | null>(null);
    const routeServerId = parseServerIdFromPathname(
        pathname.startsWith("/settings/hosts/") ? pathname.replace("/settings/hosts/", "/h/") : pathname,
    );
    // 전역 설정 화면에서는 직전에 명시적으로 선택한 호스트를 유지하며 다른 호스트를 탐색하지 않는다.
    if (routeServerId) activeServerId.current = routeServerId;
    const serverId = activeServerId.current;
    const client = useHostRuntimeClient(serverId ?? "");
    const connected = useHostRuntimeIsConnected(serverId ?? "");
    const { settings, isLoading } = useAppSettings();
    const reporting = settings as typeof settings & {
        clientErrorReportingEnabled?: boolean;
        clientErrorRetentionDays?: 1 | 7 | 30;
    };
    const enabled = !isLoading && reporting.clientErrorReportingEnabled !== false;
    const retentionDays = reporting.clientErrorRetentionDays ?? 7;

    useEffect(() => {
        reporter.configure({ enabled, retentionDays, serverId, client: connected ? client : null });
    }, [enabled, retentionDays, serverId, client, connected]);
    useEffect(() => {
        const teardown = installClientErrorHandlers(globalThis as unknown as ErrorHandlerTarget, captureClientError);
        const unsubscribeDesktop = subscribeDesktopClientErrors(getDesktopHost()?.errors, captureClientError);
        return () => {
            unsubscribeDesktop();
            teardown();
            reporter.configure({ enabled: false, serverId: null, client: null });
        };
    }, []);
    return null;
}
