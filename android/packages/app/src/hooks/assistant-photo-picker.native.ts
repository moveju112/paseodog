import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { assistantPhotoCrop, normalizeAssistantPhoto } from "./use-settings/assistant-photo";

export async function resizeAssistantPhoto(uri: string): Promise<string> {
  if (new File(uri).size > 20 * 1024 * 1024) throw new Error("Image exceeds 20 MiB");
  const context = ImageManipulator.manipulate(uri);
  let original: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  let thumbnail: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  try {
    original = await context.renderAsync();
    context.crop(assistantPhotoCrop(original.width, original.height));
    context.resize({ width: 256, height: 256 });
    thumbnail = await context.renderAsync();
    const result = await thumbnail.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.8,
      base64: true,
    });
    const photo = normalizeAssistantPhoto(`data:image/jpeg;base64,${result.base64 ?? ""}`);
    if (!photo) throw new Error("Image conversion exceeded the profile photo limit");
    return photo;
  } finally {
    thumbnail?.release();
    original?.release();
    context.release();
  }
}

export async function pickAssistantPhoto(): Promise<string | null> {
  // 첨부 사진 선택기의 전역 복구 결과를 소비하지 않는 별도 파일 선택 경로다.
  const result = await getDocumentAsync({
    type: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  return resizeAssistantPhoto(result.assets[0].uri);
}
