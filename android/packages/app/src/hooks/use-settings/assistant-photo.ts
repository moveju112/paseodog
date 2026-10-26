// 외부 URL·SVG·임시 파일 경로는 저장하지 않고 작은 JPEG 데이터만 허용한다.
export function normalizeAssistantPhoto(value: unknown): string {
  const prefix = "data:image/jpeg;base64,";
  if (typeof value !== "string" || value.length > 128 * 1024 || !value.startsWith(prefix)) {
    return "";
  }
  const data = value.slice(prefix.length);
  return data.startsWith("/9j/") && data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data)
    ? value
    : "";
}

export function assistantPhotoCrop(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid image dimensions");
  }
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}
