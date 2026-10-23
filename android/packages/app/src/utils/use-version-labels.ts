import * as React from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { requireNativeModule } from "expo-modules-core";
import { isElectronRuntime } from "@/desktop/host";
import { getDesktopRuntimeInfo } from "@/desktop/updates/desktop-updates";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { createVersionLabels } from "./version-labels";

export async function readInstalledAppRelease(): Promise<unknown> {
  if (Platform.OS === "android") {
    return requireNativeModule("PaseodogUpdater").installedRelease();
  }
  if (isElectronRuntime()) {
    const { appVersion } = await getDesktopRuntimeInfo();
    // 데스크톱 릴리즈는 제품 버전 뒤에 versionCode를 붙여 패키징한다.
    const match = appVersion && /^(.+)\.([1-9]\d*)$/.exec(appVersion);
    return { version: appVersion, versionCode: match ? Number(match[2]) : null };
  }
  return Constants.expoConfig?.extra?.paseodogRelease ?? null;
}

export const { useAppVersionText, useHostVersionText } = createVersionLabels({
  React,
  readAppRelease: readInstalledAppRelease,
  useClient: useHostRuntimeClient,
  useConnected: useHostRuntimeIsConnected,
  useProvidersSnapshot,
});
