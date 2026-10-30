import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
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
  const notifications = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    notifications
      .filter((notification) => {
        const target = resolveNotificationTarget(notification.request.content.data);
        return target.serverId === serverId && target.agentId === agentId;
      })
      .map((notification) =>
        Notifications.dismissNotificationAsync(notification.request.identifier),
      ),
  );
}
