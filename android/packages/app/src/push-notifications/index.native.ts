import { revokeSubscription, startSubscription } from "./internal/subscriptions";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./internal/types";
import { Platform } from "react-native";

export function startPushNotifications(input: StartPushNotificationsInput): () => void {
  if (Platform.OS === "android") {
    // Android는 로컬 알림만 사용한다. 기존 토큰도 연결 시 해제해 중복 알림을 막는다.
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
