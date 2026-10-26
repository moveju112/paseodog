import { afterEach, expect, it, vi } from "vitest";
import { pickAssistantPhoto, resizeAssistantPhoto } from "./assistant-photo-picker";
import { normalizeAssistantPhoto } from "./use-settings/assistant-photo";

afterEach(() => {
  vi.restoreAllMocks();
});

async function fixtureImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = "#0000ff";
  context.fillRect(256, 0, 256, 256);
  return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
}

it("converts a real image into a bounded 256px JPEG with a centered crop", async () => {
  const original = await fixtureImage();
  const photo = await resizeAssistantPhoto(original);
  expect(normalizeAssistantPhoto(photo)).toBe(photo);
  const image = new Image();
  image.src = photo;
  await image.decode();
  expect([image.naturalWidth, image.naturalHeight]).toEqual([256, 256]);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  expect(context.getImageData(64, 128, 1, 1).data[0]).toBeGreaterThan(230);
  expect(context.getImageData(192, 128, 1, 1).data[2]).toBeGreaterThan(230);
  expect(original.type).toBe("image/png");
});

it("cleans up object URLs and refuses unsupported or oversized images", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  await expect(
    resizeAssistantPhoto(new Blob(["invalid"], { type: "image/jpeg" })),
  ).rejects.toThrow();
  expect(revoke).toHaveBeenCalledTimes(1);
  await expect(
    resizeAssistantPhoto(new Blob(["<svg/>"], { type: "image/svg+xml" })),
  ).rejects.toThrow();
  await expect(
    resizeAssistantPhoto(new Blob([new Uint8Array(21 * 1024 * 1024)], { type: "image/png" })),
  ).rejects.toThrow();
  expect(revoke).toHaveBeenCalledTimes(1);
});

it("selects one file and removes its temporary input after selection or cancellation", async () => {
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  const selecting = pickAssistantPhoto();
  const input = document.querySelector<HTMLInputElement>(
    'input[accept="image/jpeg,image/png,image/webp"]',
  )!;
  expect(input.multiple).toBe(false);
  const transfer = new DataTransfer();
  transfer.items.add(new File([await fixtureImage()], "photo.png", { type: "image/png" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
  expect(normalizeAssistantPhoto(await selecting)).not.toBe("");
  expect(input.isConnected).toBe(false);
  const canceling = pickAssistantPhoto();
  const canceled = document.querySelector<HTMLInputElement>(
    'input[accept="image/jpeg,image/png,image/webp"]',
  )!;
  canceled.dispatchEvent(new Event("cancel"));
  expect(await canceling).toBeNull();
  expect(canceled.isConnected).toBe(false);
});
