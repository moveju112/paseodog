import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { dismissAndroidSessionNotifications } from "@/utils/android-notifications";

export function useDismissViewedAndroidNotifications(
  serverId: string,
  focusedAgentId: string | null,
): void {
  const isActivelyVisible = useAppActivelyVisible();

  useEffect(() => {
    if (Platform.OS !== "android" || !isActivelyVisible || !focusedAgentId) return;

    const dismiss = () => {
      void dismissAndroidSessionNotifications(serverId, focusedAgentId).catch((error) => {
        console.warn("[Notifications] Failed to dismiss viewed session notifications", error);
      });
    };
    // Android 알림창을 닫을 때는 AppState가 active인 채 focus만 다시 발생한다.
    const subscription = AppState.addEventListener("focus", dismiss);
    dismiss();
    return () => subscription.remove();
  }, [serverId, focusedAgentId, isActivelyVisible]);
}
