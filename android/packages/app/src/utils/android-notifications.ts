import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { buildAgentNotificationTag } from "@getpaseo/protocol/agent-notification-tag";
import { loadAppSettingsFromStorage } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { resolveNotificationTarget } from "./notification-routing";

const CHANNEL_ID = "paseodog-completion";

export async function shouldPresentAndroidNotification(
  data: Record<string, unknown> | null | undefined,
): Promise<boolean> {
  if (!(await loadAppSettingsFromStorage()).backgroundNotificationsEnabled) return false;
  const target = resolveNotificationTarget(data);
  const session = target.serverId
    ? useSessionStore.getState().sessions[target.serverId]
    : undefined;
  return !(
    AppState.currentState === "active" &&
    session &&
    ((target.agentId !== null && session.focusedAgentId === target.agentId) ||
      (target.terminalId !== null && session.focusedTerminalId === target.terminalId))
  );
}

export async function requestAndroidNotificationPermission(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "작업 완료 및 확인 요청",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) return true;
  if (!permission.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function sendAndroidNotification(payload: {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<boolean> {
  const settings = await loadAppSettingsFromStorage();
  if (!settings.backgroundNotificationsEnabled) return false;
  // 백그라운드에서는 권한 창을 띄우지 않는다. 권한 요청은 설정을 켤 때만 한다.
  if (!(await Notifications.getPermissionsAsync()).granted) return false;
  await Notifications.scheduleNotificationAsync({
    content: { ...payload, sound: "default" },
    trigger: { channelId: CHANNEL_ID },
  });
  return true;
}

export async function dismissAndroidSessionNotifications(
  serverId: string,
  agentId: string,
): Promise<void> {
  const sessionTag = buildAgentNotificationTag({ serverId, agentId });
  const notifications = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    notifications
      .filter((notification) => {
        const target = resolveNotificationTarget(notification.request.content.data);
        if (target.serverId !== null || target.agentId !== null) {
          return target.serverId === serverId && target.agentId === agentId;
        }
        // Expo는 FCM이 직접 표시한 알림을 tag/id URI로 돌려준다(data에는 Android 표시 속성만 남는다).
        // React Native의 URL 구현은 제한적이므로 Expo의 고정된 URI 형식만 읽는다.
        const identifier = notification.request.identifier;
        const prefix = "expo-notifications://foreign_notifications?";
        if (!sessionTag || !identifier.startsWith(prefix) || identifier.includes("#")) return false;
        const tag = identifier
          .slice(prefix.length)
          .split("&")
          .find((field) => field.startsWith("tag="));
        if (!tag) return false;
        try {
          return decodeURIComponent(tag.slice(4)) === sessionTag;
        } catch {
          return false;
        }
      })
      .map((notification) =>
        Notifications.dismissNotificationAsync(notification.request.identifier),
      ),
  );
}
