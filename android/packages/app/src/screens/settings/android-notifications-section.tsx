import { useCallback, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { useAppSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ensureOsNotificationPermission, sendOsNotification } from "@/utils/os-notifications";
import { settingsStyles } from "@/styles/settings";

function openAndroidAppSettings() {
  void Linking.openSettings();
}

export function AndroidNotificationsSection() {
  const { settings, isLoading, updateSettings } = useAppSettings();
  const [busy, setBusy] = useState(false);
  const change = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      try {
        if (enabled && !(await ensureOsNotificationPermission())) {
          Alert.alert("알림 권한 필요", "Android 설정에서 PaseoDog 알림을 허용해 주세요.", [
            { text: "취소", style: "cancel" },
            { text: "설정 열기", onPress: () => void Linking.openSettings() },
          ]);
          return;
        }
        await updateSettings({ backgroundNotificationsEnabled: enabled });
      } catch {
        Alert.alert("설정 실패", "알림 설정을 변경하지 못했어요. 다시 시도해 주세요.");
      } finally {
        setBusy(false);
      }
    },
    [updateSettings],
  );
  const sendTest = useCallback(async () => {
    const sent = await sendOsNotification({
      title: "PaseoDog 알림 테스트",
      body: "알림이 켜져 있어요.",
    });
    if (!sent) Alert.alert("알림 실패", "시스템 알림 권한을 확인해 주세요.");
  }, []);
  return (
    <SettingsSection title="알림">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>백그라운드 알림</Text>
            <Text style={settingsStyles.rowHint}>
              홈화면에서도 연결을 유지해 앱이 직접 완료·확인 요청을 알립니다. 연결 유지용 상시
              알림이 표시되고 배터리를 추가로 사용합니다. 앱 강제 종료·최근 앱에서 제거·배터리 제한
              시 수신이 중단될 수 있습니다. 화면을 꺼도 받으려면 Android 앱 설정에서 배터리 사용을
              제한 없음으로 설정해 주세요.
            </Text>
          </View>
          <Switch
            value={settings.backgroundNotificationsEnabled}
            onValueChange={change}
            disabled={busy || isLoading}
            accessibilityLabel="백그라운드 알림"
          />
        </View>
        <Button
          variant="outline"
          disabled={!settings.backgroundNotificationsEnabled || busy}
          onPress={sendTest}
        >
          알림 테스트
        </Button>
        <Button variant="outline" onPress={openAndroidAppSettings}>
          Android 앱 설정 열기
        </Button>
      </View>
    </SettingsSection>
  );
}
