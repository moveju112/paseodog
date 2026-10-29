import { useCallback, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { useAppSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ensureOsNotificationPermission, sendOsNotification } from "@/utils/os-notifications";
import { settingsStyles } from "@/styles/settings";

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
              소리·진동 알림은 완료·확인 요청에만 울립니다. 작업 중 연결 유지 상태는 무음으로
              표시됩니다. 강제 종료·깊은 절전·방해 금지에서는 제한될 수 있습니다.
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
      </View>
    </SettingsSection>
  );
}
