import { Image } from "react-native";

// 기존 로고 호출 규격을 유지하며 승인된 치와와 PD 아이콘 표시
export function PaseodogLogo({ size = 64 }: { size?: number; color?: string }) {
  return (
    <Image
      source={require("../../../assets/images/paseodog-icon.png")}
      style={{ width: size, height: size, borderRadius: size * 0.2 }}
      accessibilityLabel="PaseoDog"
      resizeMode="contain"
    />
  );
}
