import { useEffect } from "react";
import { Platform } from "react-native";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { dismissAndroidSessionNotifications } from "@/utils/android-notifications";

export function useDismissViewedAndroidNotifications(
  serverId: string,
  focusedAgentId: string | null,
): void {
  const isActivelyVisible = useAppActivelyVisible();

  useEffect(() => {
    if (Platform.OS !== "android" || !isActivelyVisible || !focusedAgentId) return;

    void dismissAndroidSessionNotifications(serverId, focusedAgentId).catch((error) => {
      console.warn("[Notifications] Failed to dismiss viewed session notifications", error);
    });
  }, [serverId, focusedAgentId, isActivelyVisible]);
}
