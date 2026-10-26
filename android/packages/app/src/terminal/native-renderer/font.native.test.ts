import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: {
    OS: "android",
    select: (options: { android?: string; default?: string }) => options.android,
  },
}));

const { resolveNativeTerminalFontFamily } = await import("./font.native");

describe("native terminal font family on Android", () => {
  it("uses the bundled JetBrains Mono for the default font stack", () => {
    expect(resolveNativeTerminalFontFamily(undefined)).toBe("JetBrainsMono");
  });

  it("keeps an explicitly chosen system monospace family", () => {
    expect(resolveNativeTerminalFontFamily("monospace")).toBe("monospace");
  });
});
