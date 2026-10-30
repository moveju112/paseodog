import { revokeSubscription, startSubscription } from "./internal/subscriptions";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./internal/types";
import { Platform } from "react-native";

export function startPushNotifications(input: StartPushNotificationsInput): () => void {
  if (Platform.OS === "android" && !input.enabled) {
    // 연결이 끊긴 상태의 opt-out도 다음 연결에서 서버에 반영한다.
    const revoke = () => {
      if (input.client.isConnected) void revokePushNotifications(input);
    };
    revoke();
    return input.client.subscribeConnectionStatus((state) => {
      if (state.status === "connected") revoke();
    });
  }
  return startSubscription(input);
}

export function revokePushNotifications(input: RevokePushNotificationsInput): Promise<void> {
  return revokeSubscription(input).catch((error) => {
    console.warn("[PushNotifications] Failed to remove local push subscription", error);
  });
}
