// 번역 원본과 키는 유지하고 사용자 입력 보간 전에 제품 표시명만 변경
export function brandTranslations<T>(resource: T): T {
  if (typeof resource === "string") {
    return resource.replace(/Paseo(?!Dog| CLI)/g, "PaseoDog") as T;
  }
  if (Array.isArray(resource)) return resource.map(brandTranslations) as T;
  if (resource && typeof resource === "object") {
    return Object.fromEntries(
      Object.entries(resource).map(([key, value]) => [key, brandTranslations(value)]),
    ) as T;
  }
  return resource;
}
