import { useRef, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { requireNativeModule } from "expo-modules-core";
import { settingsStyles } from "@/styles/settings";
import { parseAndroidUpdate, type AndroidUpdate } from "@/utils/paseodog-update";

// 사용자 요청으로 업데이트 조회, 다운로드 검증 및 Android 설치 화면 실행
export function PaseodogUpdateRow() {
  const [status, setStatus] = useState("GitHub에서 새 버전 확인");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  if (Platform.OS !== "android") return null;

  // 설치 권한이 없으면 설정으로 안내하고 재시도를 명시
  async function install(update: AndroidUpdate) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setStatus("APK 다운로드 및 무결성·서명 확인 중…");
    try {
      const native = requireNativeModule("PaseodogUpdater");
      const result = await native.install(update.url, update.sha256, update.versionCode);
      setStatus(result === "permission"
        ? "설치 허용 후 업데이트 확인을 다시 눌러주세요."
        : "설치 화면을 열었습니다. 설치 완료 여부는 Android에서 확인하세요.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  // 네트워크 실패와 최신 버전을 구분하고 다운로드 전 동의 확인
  async function checkUpdate() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setStatus("업데이트 확인 중…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(
        "https://github.com/moveju112/paseodog/releases/latest/download/paseodog-android-update.json",
        { signal: controller.signal, headers: { "Cache-Control": "no-cache" } },
      );
      if (!response.ok) throw new Error(`업데이트 조회 실패: HTTP ${response.status}`);
      const update = parseAndroidUpdate(
        await response.json(),
        requireNativeModule("PaseodogUpdater").installedVersion(),
        requireNativeModule("PaseodogUpdater").supportedAbis(),
      );
      if (!update) {
        setStatus("현재 최신 버전입니다.");
      } else {
        setStatus(`새 버전 ${update.versionName} (빌드 ${update.versionCode})`);
        const size = update.size === undefined ? "용량 정보 없음" : `${(update.size / 1024 / 1024).toFixed(1)} MiB`;
        Alert.alert("PaseoDog 업데이트", `${update.versionName} APK를 내려받을까요? 다운로드 ${size}. 설치 시 Android 승인이 필요합니다.`, [
          { text: "취소", style: "cancel" },
          { text: "다운로드", onPress: () => void install(update) },
        ]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="PaseoDog 업데이트 확인"
      accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void checkUpdate()}
      style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>PaseoDog 업데이트 확인</Text>
        <Text accessibilityLiveRegion="polite" style={settingsStyles.rowHint}>{status}</Text>
      </View>
    </Pressable>
  );
}
