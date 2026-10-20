import { ActivityIndicator } from "react-native";
import { useRetainedPanelActive } from "@/components/retained-panel";

// 진행 중 로더 (네이티브 OS 도넛 스피너, 숨겨진 패널에서는 정지)
// 웹/데스크톱은 synced-loader.tsx의 점 로더를 그대로 쓴다. Android에서는 Reanimated UI 스레드
// 시계로 그리는 점 로더가 멈춘 채 보였으므로, OS가 직접 애니메이션하는 ActivityIndicator를 쓴다.
export function SyncedLoader({ size = 10, color }: { size?: number; color: string }) {
  const active = useRetainedPanelActive();
  return <ActivityIndicator size={size} color={color} animating={active} />;
}
