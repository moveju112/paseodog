export interface AndroidUpdate {
  versionCode: number;
  versionName: string;
  url: string;
  sha256: string;
  size?: number;
}

// 릴리스 메타데이터 검증 후 설치된 빌드보다 새로운 APK만 선택
export function parseAndroidUpdate(value: unknown, installedVersion: number, supportedAbis: string[] = []): AndroidUpdate | null {
  if (!value || typeof value !== "object") throw new Error("업데이트 정보가 올바르지 않습니다.");
  const data = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(data.versionCode) ||
    (data.versionCode as number) <= 0 ||
    typeof data.versionName !== "string" ||
    !data.versionName.trim() ||
    typeof data.url !== "string" ||
    !/^https:\/\/github\.com\/moveju112\/paseodog\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.apk$/.test(data.url) ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    (data.size !== undefined && (!Number.isSafeInteger(data.size) || (data.size as number) <= 0))
  ) throw new Error("업데이트 정보의 버전·주소·해시를 확인할 수 없습니다.");
  if (data.artifacts !== undefined) {
    if (!Array.isArray(data.artifacts) || data.artifacts.length === 0)
      throw new Error("아키텍처별 업데이트 정보가 올바르지 않습니다.");
    const seen = new Set<string>();
    const artifacts = data.artifacts.map((item: unknown) => {
      if (!item || typeof item !== "object") throw new Error("APK 정보가 올바르지 않습니다.");
      const artifact = item as Record<string, unknown>;
      if (typeof artifact.abi !== "string" ||
          !["armeabi-v7a", "arm64-v8a", "x86", "x86_64"].includes(artifact.abi) ||
          seen.has(artifact.abi) || artifact.size === undefined)
        throw new Error("APK 아키텍처·용량 정보가 올바르지 않습니다.");
      seen.add(artifact.abi);
      // 버전은 릴리즈 공통값만 사용하며 각 다운로드의 주소·해시·용량도 동일하게 검증한다.
      const parsed = parseAndroidUpdate({
        versionCode: data.versionCode, versionName: data.versionName,
        url: artifact.url, sha256: artifact.sha256, size: artifact.size,
      }, 0)!;
      return { ...parsed, abi: artifact.abi };
    });
    if ((data.versionCode as number) <= installedVersion) return null;
    if (supportedAbis.length) {
      for (const abi of supportedAbis) {
        const selected = artifacts.find((artifact) => artifact.abi === abi);
        if (selected) return selected;
      }
      throw new Error("이 기기에 맞는 업데이트 APK가 없습니다.");
    }
  }
  return (data.versionCode as number) > installedVersion ? {
    versionCode: data.versionCode as number, versionName: data.versionName,
    url: data.url, sha256: data.sha256, ...(data.size === undefined ? {} : { size: data.size as number }),
  } : null;
}
