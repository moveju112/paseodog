/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImageAttachmentPicker } from "./use-image-attachment-picker";

const picker = vi.hoisted(() => ({
  requestPermission: vi.fn(),
  pending: vi.fn(),
  launch: vi.fn(),
  normalize: vi.fn(),
  alert: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/diagnostics/client-error-runtime", () => ({
  captureClientError: picker.capture,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Alert: { alert: picker.alert },
}));
vi.mock("expo-image-picker", () => ({
  useMediaLibraryPermissions: () => [
    { status: "undetermined", granted: false },
    picker.requestPermission,
  ],
  PermissionStatus: { UNDETERMINED: "undetermined" },
  getPendingResultAsync: picker.pending,
  launchImageLibraryAsync: picker.launch,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/desktop/host", () => ({
  getDesktopHost: vi.fn(),
  isElectronRuntime: () => false,
}));
vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("@/hooks/image-attachment-picker", () => ({
  normalizePickedImageAssets: picker.normalize,
  pickImagesWithDesktopDialog: vi.fn(),
}));

const assets = [
  {
    uri: "file:///cache/picked.png",
    mimeType: "image/png",
    fileName: "picked.png",
  },
];
const attachments = [
  {
    source: { kind: "file_uri", uri: assets[0].uri },
    mimeType: "image/png",
    fileName: "picked.png",
  },
];

describe("Android image attachment selection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    picker.pending.mockResolvedValue(null);
    picker.launch.mockResolvedValue({ canceled: false, assets });
    picker.normalize.mockResolvedValue(attachments);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("uses the system picker without requesting broad media access", async () => {
    picker.requestPermission.mockRejectedValue(new Error("Permission request already active"));
    const { result } = renderHook(() => useImageAttachmentPicker());

    await expect(result.current.pickImages()).resolves.toEqual(attachments);

    expect(picker.requestPermission).not.toHaveBeenCalled();
    expect(picker.launch).toHaveBeenCalledExactlyOnceWith({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    expect(picker.normalize).toHaveBeenCalledExactlyOnceWith(assets);
    expect(picker.alert).not.toHaveBeenCalled();
  });

  it("returns cancellation without normalization or an error alert", async () => {
    picker.launch.mockResolvedValue({ canceled: true, assets: null });
    const { result } = renderHook(() => useImageAttachmentPicker());

    await expect(result.current.pickImages()).resolves.toBeNull();

    expect(picker.normalize).not.toHaveBeenCalled();
    expect(picker.alert).not.toHaveBeenCalled();
  });

  it("recovers an activity result without opening another picker", async () => {
    picker.pending.mockResolvedValue({ canceled: false, assets });
    const { result } = renderHook(() => useImageAttachmentPicker());

    await expect(result.current.pickImages()).resolves.toEqual(attachments);

    expect(picker.launch).not.toHaveBeenCalled();
    expect(picker.normalize).toHaveBeenCalledExactlyOnceWith(assets);
  });

  it("does not relaunch after a recovered cancellation", async () => {
    picker.pending.mockResolvedValue({ canceled: true, assets: null });
    const { result } = renderHook(() => useImageAttachmentPicker());

    await expect(result.current.pickImages()).resolves.toBeNull();

    expect(picker.launch).not.toHaveBeenCalled();
    expect(picker.alert).not.toHaveBeenCalled();
  });

  it("surfaces a recovered native error instead of silently starting over", async () => {
    picker.pending.mockResolvedValue({ code: "E_PICKER", message: "Unreadable image" });
    const { result } = renderHook(() => useImageAttachmentPicker());

    await expect(result.current.pickImages()).resolves.toBeNull();

    expect(picker.launch).not.toHaveBeenCalled();
    expect(picker.normalize).not.toHaveBeenCalled();
    expect(picker.alert).toHaveBeenCalledExactlyOnceWith(
      "imageAttachmentPicker.errorTitle",
      "imageAttachmentPicker.failedToSelect\n\n[recovery/unknown] E_PICKER: Unreadable image",
    );
    expect(console.error).toHaveBeenCalledWith(
      "[ImageAttachmentPicker] Failed to pick image:",
      new Error("E_PICKER: Unreadable image"),
    );
  });

  it.each(["pending", "launch", "normalize"] as const)(
    "reports a genuine %s failure and permits a subsequent retry",
    async (operation) => {
      picker[operation].mockRejectedValueOnce(new Error("Unreadable image"));
      const { result } = renderHook(() => useImageAttachmentPicker());

      await expect(result.current.pickImages()).resolves.toBeNull();
      expect(picker.capture).toHaveBeenCalledExactlyOnceWith(
        expect.any(Error),
        "image-picker",
        operation === "pending" ? "recovery" : operation,
      );
      expect(picker.alert).toHaveBeenCalledExactlyOnceWith(
        "imageAttachmentPicker.errorTitle",
        `imageAttachmentPicker.failedToSelect\n\n[${operation === "pending" ? "recovery" : operation}/unknown] Unreadable image`,
      );

      await expect(result.current.pickImages()).resolves.toEqual(attachments);
    },
  );

  it("shows a launch rejection code without normalizing an image", async () => {
    picker.launch.mockRejectedValueOnce(
      Object.assign(new Error("No activity available"), { code: "ERR_NO_ACTIVITY" }),
    );
    const { result } = renderHook(() => useImageAttachmentPicker());

    await expect(result.current.pickImages()).resolves.toBeNull();

    expect(picker.alert).toHaveBeenCalledExactlyOnceWith(
      "imageAttachmentPicker.errorTitle",
      "imageAttachmentPicker.failedToSelect\n\n[launch/ERR_NO_ACTIVITY] No activity available",
    );
    expect(picker.normalize).not.toHaveBeenCalled();
  });

  it("keeps its lock across rerenders until attachment validation finishes", async () => {
    const normalization = Promise.withResolvers<typeof attachments>();
    picker.normalize.mockReturnValueOnce(normalization.promise);
    const { result, rerender } = renderHook(() => useImageAttachmentPicker());
    const firstPick = result.current.pickImages();
    await vi.waitFor(() => expect(picker.normalize).toHaveBeenCalledTimes(1));
    rerender();

    await expect(result.current.pickImages()).resolves.toBeNull();
    expect(picker.launch).toHaveBeenCalledTimes(1);

    normalization.resolve(attachments);
    await expect(firstPick).resolves.toEqual(attachments);
    await expect(result.current.pickImages()).resolves.toEqual(attachments);
    expect(picker.launch).toHaveBeenCalledTimes(2);
  });
});
