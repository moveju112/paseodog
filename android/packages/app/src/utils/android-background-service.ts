import { requireNativeModule } from "expo-modules-core";
import { AppRegistry, Platform } from "react-native";
import { isFdroidBuild } from "@/constants/build-profile";

interface BackgroundNotificationsModule {
  start(): Promise<void>;
  stop(): Promise<void>;
  waitUntilStopped(generation: string): Promise<void>;
}

function nativeModule(): BackgroundNotificationsModule {
  return requireNativeModule<BackgroundNotificationsModule>("PaseodogBackgroundNotifications");
}

if (Platform.OS === "android" && !isFdroidBuild) {
  // 서비스 시작보다 먼저 등록한다. 기존 앱 연결을 유지하므로 별도 연결·인증은 만들지 않는다.
  AppRegistry.registerHeadlessTask("PaseodogBackgroundNotifications", () => {
    return ({ generation }: { generation: string }) => nativeModule().waitUntilStopped(generation);
  });
}

export async function startAndroidBackgroundService(): Promise<void> {
  await nativeModule().start();
}

export async function stopAndroidBackgroundService(): Promise<void> {
  await nativeModule().stop();
}
