/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageMeter } from "./meter";
import { windowTone } from "./tone";
import type { UsageTone } from "./types";

vi.stubGlobal("React", React);
afterEach(cleanup);

describe("UsageMeter", () => {
  it.each([
    [0, "default", "rgb(102, 102, 102)"],
    [69.99, "default", "rgb(102, 102, 102)"],
    [70, "warning", "rgb(217, 119, 6)"],
    [90, "warning", "rgb(217, 119, 6)"],
    [90.01, "danger", "rgb(185, 28, 28)"],
    [100, "danger", "rgb(185, 28, 28)"],
  ] as const)("uses the host tone at %s%% even when quiet", (percent, tone, color) => {
    const hostTone = windowTone({ id: "session", label: "Session", usedPct: percent });
    expect(hostTone).toBe(tone);
    const { container, rerender } = render(<UsageMeter percent={percent} tone={hostTone} quiet />);
    const fill = container.querySelector<HTMLElement>("div > div > div");
    expect(fill?.style.backgroundColor).toBe(color);
    expect(fill?.style.width).toBe(`${percent}%`);
    rerender(<UsageMeter percent={percent} tone={hostTone} />);
    expect(fill?.style.backgroundColor).toBe(color);
  });

  it.each([
    ["ok", "rgb(21, 128, 61)"],
    ["warning", "rgb(217, 119, 6)"],
    ["danger", "rgb(185, 28, 28)"],
  ] satisfies [UsageTone, string][])("preserves an explicit %s source tone", (tone, color) => {
    const hostTone = windowTone({ id: "session", label: "Session", usedPct: 10, tone });
    const { container } = render(<UsageMeter percent={10} tone={hostTone} quiet />);
    expect(container.querySelector<HTMLElement>("div > div > div")?.style.backgroundColor).toBe(
      color,
    );
  });

  it.each([
    [-10, "0%"],
    [120, "100%"],
  ])("clamps %s without changing its danger tone", (percent, width) => {
    const { container } = render(<UsageMeter percent={percent} tone="danger" quiet />);
    const fill = container.querySelector<HTMLElement>("div > div > div");
    expect(fill?.style.width).toBe(width);
    expect(fill?.style.backgroundColor).toBe("rgb(185, 28, 28)");
  });
});
