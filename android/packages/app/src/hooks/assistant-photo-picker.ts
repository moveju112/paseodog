import { assistantPhotoCrop, normalizeAssistantPhoto } from "./use-settings/assistant-photo";

// 원본 경로·EXIF 없이 중앙 정사각형 썸네일만 설정에 보관한다.
export async function resizeAssistantPhoto(file: Blob): Promise<string> {
  if (
    file.size > 20 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  ) {
    throw new Error("Choose a JPEG, PNG or WebP image up to 20 MiB");
  }
  const uri = URL.createObjectURL(file);
  try {
    const image = new globalThis.Image();
    image.src = uri;
    await image.decode();
    const crop = assistantPhotoCrop(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, crop.originX, crop.originY, crop.width, crop.height, 0, 0, 256, 256);
    const photo = normalizeAssistantPhoto(canvas.toDataURL("image/jpeg", 0.8));
    if (!photo) throw new Error("Image conversion exceeded the profile photo limit");
    return photo;
  } finally {
    URL.revokeObjectURL(uri);
  }
}

export function pickAssistantPhoto(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.multiple = false;
    input.hidden = true;
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve(null);
      },
      { once: true },
    );
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        void resizeAssistantPhoto(file).then(resolve, reject);
      },
      { once: true },
    );
    document.body.appendChild(input);
    try {
      input.click();
    } catch (error) {
      input.remove();
      reject(error);
    }
  });
}
