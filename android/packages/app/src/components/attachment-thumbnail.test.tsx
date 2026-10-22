// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import { AttachmentThumbnail } from "./attachment-pill";

const preview = vi.hoisted(() => ({ uri: "blob:preview" as string | null }));
vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: () => preview.uri,
}));
vi.mock("@/constants/platform", () => ({ isNative: false }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("lucide-react-native", () => ({ X: "span" }));
vi.mock("react-native", () => ({
  // 네이티브 스타일 배열을 DOM 스타일로 합쳐 실제 표시 크기를 검사한다.
  Image: ({ style }: { style: React.CSSProperties[] }) =>
    React.createElement("img", {
      alt: "attachment",
      style: Object.assign({}, ...style.filter(Boolean)),
    }),
  View: ({ style }: { style: React.CSSProperties[] }) =>
    React.createElement("div", {
      "data-testid": "placeholder",
      style: Object.assign({}, ...style.filter(Boolean)),
    }),
  Pressable: "button",
  Text: "span",
}));
vi.mock("react-native-unistyles", () => ({
  withUnistyles: (component: unknown) => component,
  StyleSheet: {
    create: (factory: (theme: unknown) => unknown) =>
      factory({
        colors: {},
        borderRadius: { md: 6 },
        borderWidth: { 1: 1 },
        spacing: { 2: 8, 3: 12 },
        fontSize: { base: 14, sm: 12 },
      }),
  },
}));

const metadata = {} as AttachmentMetadata;
beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each([false, true])("thumbnail sent=%s retains its size during image loading", (sent) => {
  preview.uri = "blob:preview";
  const { rerender } = render(<AttachmentThumbnail metadata={metadata} sent={sent} />);
  const size = sent ? "96px" : "48px";
  expect(screen.getByRole("img").style.width).toBe(size);
  expect(screen.getByRole("img").style.height).toBe(size);
  preview.uri = null;
  rerender(<AttachmentThumbnail metadata={metadata} sent={sent} />);
  expect(screen.getByTestId("placeholder").style.width).toBe(size);
  expect(screen.getByTestId("placeholder").style.height).toBe(size);
});
