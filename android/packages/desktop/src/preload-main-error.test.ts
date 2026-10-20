import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { DesktopMainErrorEvent } from "./main-error-bridge.js";

const bridge = vi.hoisted(() => ({ exposed: {} as Record<string, unknown>, send: vi.fn() }));
vi.mock("electron", async () => {
    const { EventEmitter } = await import("node:events");
    return {
        contextBridge: {
            exposeInMainWorld: (_name: string, api: Record<string, unknown>) => { bridge.exposed = api; },
        },
        ipcRenderer: Object.assign(new EventEmitter(), { send: bridge.send }),
        webUtils: {},
    };
});

describe("narrow main error preload subscription", () => {
    it("validates and projects payloads, shares IPC listener and tears down independent subscriptions", async () => {
        await import("./preload.js");
        const { ipcRenderer } = await import("electron");
        const ipc = ipcRenderer as unknown as EventEmitter;
        const api = bridge.exposed.errors as {
            onError(handler: (event: DesktopMainErrorEvent) => void): () => void;
        };
        const received: DesktopMainErrorEvent[] = [];
        const handler = (event: DesktopMainErrorEvent) => { received.push(event); };
        const first = api.onError(handler);
        const second = api.onError(handler);
        const throwing = api.onError(() => { throw new Error("reporter unavailable"); });
        expect(ipc.listenerCount("paseo:main-error")).toBe(1);
        expect(bridge.send.mock.calls).toEqual([["paseo:main-error:subscribe", true]]);
        const valid: DesktopMainErrorEvent = {
            source: "desktop-main", kind: "console-error", code: "MAIN_CONSOLE_ERROR",
            name: "Error", frames: [], diagnosticLoss: "message-stack-properties-arguments-omitted",
        };
        ipc.emit("paseo:main-error", { sender: "never expose" }, { ...valid, message: "secret" });
        expect(received).toEqual([valid, valid]);
        for (const invalid of [null, "secret", { ...valid, name: "secret" },
            { ...valid, frames: ["/private/path"] }, { ...valid, code: "SECRET" },
            { ...valid, kind: "__proto__" }, { ...valid, diagnosticLoss: undefined }]) {
            ipc.emit("paseo:main-error", {}, invalid);
        }
        expect(received).toHaveLength(2);
        first();
        first();
        ipc.emit("paseo:main-error", {}, valid);
        expect(received).toHaveLength(3);
        second();
        throwing();
        expect(ipc.listenerCount("paseo:main-error")).toBe(0);
        expect(bridge.send.mock.calls.at(-1)).toEqual(["paseo:main-error:subscribe", false]);
    });
});
