import { describe, expect, it, vi } from "vitest";
import { captureDesktopMainError, subscribeDesktopClientErrors } from "./client-error-desktop";
import { sanitizeClientError } from "./client-errors";

const mainEvent = {
    source: "desktop-main", kind: "console-error", code: "MAIN_CONSOLE_ERROR", name: "Error",
    frames: [], diagnosticLoss: "message-stack-properties-arguments-omitted",
};

describe("desktop main diagnostic bridge", () => {
    it.each([
        ["console-error", "MAIN_CONSOLE_ERROR"],
        ["unhandled-rejection", "MAIN_UNHANDLED_REJECTION"],
        ["uncaught-exception", "MAIN_UNCAUGHT_EXCEPTION"],
    ])("accepts only the %s classification and ignores attached freeform data", (kind, code) => {
        const capture = vi.fn();
        captureDesktopMainError({ ...mainEvent, kind, code,
            message: "private prompt", stack: "/home/private", token: "sk-private",
        }, capture);
        expect(capture).toHaveBeenCalledOnce();
        const [error, source] = capture.mock.calls[0];
        expect(sanitizeClientError(error, source)).toEqual({ source: "desktop-main", code, message: "Error captured" });
    });

    it("drops raw console strings, mismatched codes, arbitrary names and malformed bridge events", () => {
        const capture = vi.fn();
        for (const input of [
            "private", {}, null, { ...mainEvent, kind: "__proto__" },
            { ...mainEvent, source: "unknown" }, { ...mainEvent, code: "MAIN_UNHANDLED_REJECTION" },
            { ...mainEvent, name: "private" },
        ]) captureDesktopMainError(input, capture);
        expect(capture).not.toHaveBeenCalled();
    });

    it("subscribes once, tears down and isolates bridge/capture failure", () => {
        const unsubscribe = vi.fn();
        const capture = vi.fn(() => { throw new Error("private"); });
        const onError = vi.fn(() => unsubscribe);
        const teardown = subscribeDesktopClientErrors({ onError }, capture);
        expect(onError).toHaveBeenCalledOnce();
        expect(() => (onError.mock.calls[0] as unknown as [Function])[0](mainEvent)).not.toThrow();
        teardown();
        expect(unsubscribe).toHaveBeenCalledOnce();
        const failing = { onError: () => { throw new Error("private"); } };
        expect(() => subscribeDesktopClientErrors(failing, capture)()).not.toThrow();
        expect(() => subscribeDesktopClientErrors(undefined, capture)()).not.toThrow();
    });
});
