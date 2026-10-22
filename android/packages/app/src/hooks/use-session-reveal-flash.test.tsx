/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionRevealFlash } from "./use-session-reveal-flash";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSessionRevealFlash", () => {
  it("shows two 400ms flashes with a 120ms gap and then stays hidden", () => {
    const { result, rerender } = renderHook(({ id }) => useSessionRevealFlash(id), {
      initialProps: { id: null as number | null },
    });
    expect(result.current).toBe(false);
    rerender({ id: 1 });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(399));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(119));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(399));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false);
  });

  it("restarts both flashes when the same session is selected again with a new request", () => {
    const { result, rerender } = renderHook(({ id }) => useSessionRevealFlash(id), {
      initialProps: { id: 1 },
    });
    act(() => vi.advanceTimersByTime(250));
    rerender({ id: 2 });
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(250));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(120));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe(false);
  });

  it("cancels pending flashes on deselection and unmount", () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useSessionRevealFlash(id), {
      initialProps: { id: 1 as number | null },
    });
    rerender({ id: null });
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false);
    rerender({ id: 2 });
    expect(result.current).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
