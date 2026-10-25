import { describe, expect, it, vi } from "vitest";
import { createInterruptConfirmation } from "./interrupt-confirmation";

describe("keyboard interrupt confirmation", () => {
  it("keeps the current run and draft unchanged when confirmation is cancelled", async () => {
    const state = { running: true, draft: "keep this draft" };
    const interrupt = vi.fn(() => {
      state.running = false;
    });
    await createInterruptConfirmation()({
      confirm: async () => false,
      isCurrent: () => true,
      interrupt,
      reportError: vi.fn(),
    });
    expect(interrupt).not.toHaveBeenCalled();
    expect(state).toEqual({ running: true, draft: "keep this draft" });
  });

  it("interrupts only after approval and only while the original turn remains current", async () => {
    for (const isCurrent of [true, false]) {
      const interrupt = vi.fn();
      await createInterruptConfirmation()({
        confirm: async () => true,
        isCurrent: () => isCurrent,
        interrupt,
        reportError: vi.fn(),
      });
      expect(interrupt).toHaveBeenCalledTimes(isCurrent ? 1 : 0);
    }
  });

  it("coalesces repeated Esc presses and allows a new confirmation after dismissal", async () => {
    let resolve!: (value: boolean) => void;
    const confirm = vi.fn(
      () => new Promise<boolean>((resolvePromise) => (resolve = resolvePromise)),
    );
    const request = {
      confirm,
      isCurrent: () => true,
      interrupt: vi.fn(),
      reportError: vi.fn(),
    };
    const handle = createInterruptConfirmation();
    const first = handle(request);
    await handle(request);
    expect(confirm).toHaveBeenCalledTimes(1);
    resolve(false);
    await first;
    const next = handle(request);
    expect(confirm).toHaveBeenCalledTimes(2);
    resolve(true);
    await next;
    expect(request.interrupt).toHaveBeenCalledTimes(1);
  });

  it("does not interrupt if the confirmation backend fails", async () => {
    const error = new Error("dialog unavailable");
    const request = {
      confirm: async () => {
        throw error;
      },
      isCurrent: () => true,
      interrupt: vi.fn(),
      reportError: vi.fn(),
    };
    const handle = createInterruptConfirmation();
    await handle(request);
    expect(request.interrupt).not.toHaveBeenCalled();
    expect(request.reportError).toHaveBeenCalledWith(error);
    await handle({ ...request, confirm: async () => true });
    expect(request.interrupt).toHaveBeenCalledTimes(1);
  });
});
