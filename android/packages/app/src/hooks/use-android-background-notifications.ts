import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { isFdroidBuild } from "@/constants/build-profile";
import { useAppSettings } from "@/hooks/use-settings";
import {
  startAndroidBackgroundService,
  stopAndroidBackgroundService,
} from "@/utils/android-background-service";

export function useAndroidBackgroundNotifications(): void {
  const { settings, isLoading } = useAppSettings();
  const pending = useRef(Promise.resolve());
  const enabled = settings.backgroundNotificationsEnabled;

  useEffect(() => {
    if (Platform.OS !== "android" || isFdroidBuild || isLoading) return;
    let disposed = false;
    const enqueue = (operation: () => Promise<void>) => {
      pending.current = pending.current
        .then(operation)
        .catch((error) => console.warn("[Notifications] Background service failed", error));
    };
    const reconcile = () => {
      enqueue(async () => {
        if (disposed) return;
        if (!enabled) {
          await stopAndroidBackgroundService();
          return;
        }
        // Android 12+에서는 홈화면으로 나간 뒤 foreground service를 새로 시작할 수 없다.
        if (AppState.currentState !== "active") return;
        const permission = await Notifications.getPermissionsAsync();
        if (disposed) return;
        if (!permission.granted) {
          await stopAndroidBackgroundService();
          return;
        }
        if (AppState.currentState === "active") await startAndroidBackgroundService();
      });
    };
    reconcile();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reconcile();
    });
    return () => {
      disposed = true;
      subscription.remove();
      // 설정을 빠르게 껐다 켜도 이전 cleanup이 새 start를 뒤늦게 취소하지 않도록 직렬화한다.
      enqueue(stopAndroidBackgroundService);
    };
  }, [enabled, isLoading]);
}
