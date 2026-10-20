import { describe, expect, it } from "vitest";
import {
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  lightWhite2Theme,
  REGISTERED_THEMES,
  THEME_OPTIONS,
  THEME_SWATCHES,
  THEME_TO_UNISTYLES,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
      "white2",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("white2");
    expect(getNextThemePreference("white2")).toBe("light");
  });
});

describe("White2 theme", () => {
  it("preserves Light except for the PC contrast overrides", () => {
    expect(lightWhite2Theme).toEqual({
      ...lightTheme,
      colors: {
        ...lightTheme.colors,
        foregroundMuted: "#52525b",
        foregroundExtraMuted: "#71717a",
        mutedForeground: "#52525b",
        border: "#d4d4d8",
        borderAccent: "#c4c4cc",
        accentBorder: "#c4c4cc",
        composerPlaceholder: "#71717a",
        composerFocusHintOpacity: 1,
      },
    });
    expect(lightTheme.colors.foregroundMuted).toBe("#71717a");
    expect(lightTheme.colors.border).toBe("#e4e4e7");
  });

  it("registers a light variant and white swatch from the catalog", () => {
    expect(THEME_TO_UNISTYLES.white2).toBe("lightWhite2");
    expect(REGISTERED_THEMES.lightWhite2).toBe(lightWhite2Theme);
    expect(THEME_SWATCHES.white2).toBe("#ffffff");
    expect(lightWhite2Theme.colorScheme).toBe("light");
  });

  it("preserves the composer contrast defaults for every other theme", () => {
    for (const option of THEME_OPTIONS) {
      if (option.name === "auto" || option.name === "white2") continue;
      expect(option.theme.colors.composerPlaceholder).toBe(option.theme.colors.surface4);
      expect(option.theme.colors.composerFocusHintOpacity).toBe(0.5);
    }
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Paseo's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("derives sidebar interaction surfaces from the surface scale", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(darkPureBlackTheme.colors.surface1);
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe(
      darkPureBlackTheme.colors.surface2,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Sidebar interaction surfaces", () => {
  it("keeps Light selection distinct from the sidebar surface", () => {
    expect(lightTheme.colors.surfaceSidebarHover).toBe(lightTheme.colors.surface1);
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface3);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
  });

  it("derives Dark hover and selection from the first two raised surfaces", () => {
    expect(darkTheme.colors.surfaceSidebarHover).toBe(darkTheme.colors.surface1);
    expect(darkTheme.colors.surfaceSidebarSelected).toBe(darkTheme.colors.surface2);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});
