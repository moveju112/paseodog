import { describe, expect, it, vi } from "vitest";
import { ClientErrorReporter, sanitizeClientError, type ClientErrorRpcClient } from "./client-errors";
import { installClientErrorHandlers, type ErrorHandlerTarget } from "./client-error-handlers";

// 고정 시간과 UUID로 네트워크 없이 큐 동작을 검증한다.
function fixture() {
    let time = 1700000000000;
    let sequence = 0;
    const reporter = new ClientErrorReporter({
        now: () => time,
        uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        platform: "android", appVersion: "0.11.4", osVersion: "35",
    });
    const invokePluginRpc = vi.fn(async (_plugin: string, _method: string, input: any) => ({
        accepted: input.action === "clear" ? 0 : input.events.length,
    }));
    const client: ClientErrorRpcClient = { invokePluginRpc };
    // 명시적인 스택 위치만 달리하여 중복 제거와 큐 한계를 독립 검증한다.
    const capture = (line = 1) => {
        const error = new Error("private prompt file:///secret/image.png sk-private");
        error.stack = `Error: secret\n at privateFunction (/home/person/secret.ts:${line}:2)`;
        reporter.capture(error, "image-picker", "launch");
    };
    return { reporter, client, invokePluginRpc, capture, advance: (ms: number) => { time += ms; } };
}

describe("privacy-safe client errors", () => {
    it.each([
        "Bearer secret-token", "data:image/png;base64,PRIVATE", "/home/private/a.png",
        "C:\\Users\\private\\image.png", "https://host/?token=private", "prompt: secret",
        "user@example.com", "sk-private", "\u202esecret",
    ])("never transmits arbitrary error payload %s", (privateText) => {
        const error = Object.assign(new Error(privateText), {
            name: privateText, code: privateText, image: privateText, prompt: privateText,
        });
        error.stack = `${privateText}\n at ${privateText} (/home/private/index.ts:123:45)\n${privateText}`;
        const safe = sanitizeClientError(error, "console");
        expect(safe).toEqual({
            source: "console", code: "Error", message: "Error captured", stack: "at <frame>:123:45",
        });
        expect(JSON.stringify(safe)).not.toContain(privateText);
    });

    it("drops non-errors, unsafe metadata, invalid stages and hostile getters", () => {
        expect(sanitizeClientError("private console", "console")).toBeNull();
        expect(sanitizeClientError({ message: "private" }, "rejection")).toBeNull();
        expect(sanitizeClientError({ message: "private", image: "private" }, "image-picker", "launch"))
            .toEqual({ source: "image-picker", stage: "launch", code: "Error", message: "Image attachment selection failed" });
        expect(sanitizeClientError(new Error(), "console", "private" as any)).toBeNull();
        const error = new Error();
        Object.defineProperty(error, "name", { get() { throw new Error("secret"); } });
        expect(sanitizeClientError(error, "console")).toBeNull();
        expect(sanitizeClientError(Object.assign(new TypeError("secret"), { code: "ERR_NO_ACTIVITY" }), "image-picker", "launch"))
            .toMatchObject({ code: "ERR_NO_ACTIVITY", message: "Image attachment selection failed", stage: "launch" });
    });

    it.each([
        ["Current Activity is not available: private /home/person/photo.png", "PICKER_ACTIVITY_UNAVAILABLE", "Image picker current activity is unavailable"],
        ["Attempting to launch an unregistered ActivityResultLauncher: token sk-private", "PICKER_LAUNCHER_UNREGISTERED", "Image picker activity result launcher is unregistered"],
        ["lateinit property privatePrompt has not been initialized", "PICKER_UNINITIALIZED", "Image picker native initialization is incomplete"],
    ])("classifies a known native failure without its freeform payload", (message, code, safeMessage) => {
        for (const error of [new Error(message), { message, code: "private" }]) {
            const safe = sanitizeClientError(error, "image-picker", "launch");
            expect(safe).toMatchObject({ source: "image-picker", stage: "launch", code, message: safeMessage });
            expect(JSON.stringify(safe)).not.toContain("private");
        }
    });

    it("retains only allowlisted frame identifiers, never arbitrary names or paths", () => {
        const error = new Error("private");
        error.stack = "Error: private\n at pickImages (/private/secret.ts:4:5)\nprivateToken@file:///private/secret.ts:6:7\nlaunchImageLibraryAsync@file:///private/secret.ts:8:9";
        expect(sanitizeClientError(error, "image-picker", "launch")?.stack)
            .toBe("at pickImages:4:5\nat <frame>:6:7\nat launchImageLibraryAsync:8:9");
    });

    it.each(["android", "ios", "web", "desktop"] as const)("shares handled Error console capture on %s without forwarding console text", async (platform) => {
        const invokePluginRpc = vi.fn(async () => ({ accepted: 1 }));
        const reporter = new ClientErrorReporter({
            now: () => 1700000000000, uuid: () => "00000000-0000-4000-8000-000000000001",
            platform, appVersion: "0.11.4",
        });
        reporter.configure({ enabled: true, serverId: "active", client: { invokePluginRpc } });
        const previousConsole = vi.fn();
        const target = { console: { error: previousConsole } };
        const teardown = installClientErrorHandlers(target, (error, source) => reporter.capture(error, source));
        target.console.error("prompt private", { token: "private" }, new TypeError("private"));
        await reporter.flush();
        expect(previousConsole).toHaveBeenCalledOnce();
        expect(invokePluginRpc).toHaveBeenCalledOnce();
        const event = (invokePluginRpc.mock.calls[0] as unknown as [string, string, any])[2].events[0];
        expect(event).toMatchObject({ platform, source: "console", code: "TypeError", message: "TypeError captured" });
        expect(JSON.stringify(event)).not.toContain("private");
        teardown();
    });

    it("queues offline then sends only to the active authenticated runtime on reconnect", async () => {
        const f = fixture();
        f.reporter.configure({ enabled: true, serverId: "active", client: null });
        f.capture();
        expect(f.invokePluginRpc).not.toHaveBeenCalled();
        f.reporter.configure({ enabled: true, serverId: "active", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc).toHaveBeenCalledTimes(1);
        const [plugin, method, input] = f.invokePluginRpc.mock.calls[0];
        expect([plugin, method]).toEqual(["paseodog-provider", "client-errors"]);
        expect(input.events).toHaveLength(1);
        expect(input.events[0]).toMatchObject({
            id: "00000000-0000-4000-8000-000000000001", timestamp: 1700000000000,
            platform: "android", appVersion: "0.11.4", osVersion: "35",
        });
        expect(Object.keys(input.events[0]).sort()).toEqual([
            "appVersion", "code", "id", "message", "osVersion", "platform", "source", "stack", "stage", "timestamp",
        ]);
        expect(JSON.stringify(input)).not.toMatch(/private|prompt|file:|sk-/);
    });

    it("does not duplicate explicit picker errors through console interception", async () => {
        const f = fixture();
        f.reporter.configure({ enabled: true, serverId: "active", client: null });
        const error = new Error("private");
        f.reporter.capture(error, "image-picker", "normalize");
        f.reporter.capture(error, "console");
        f.reporter.configure({ enabled: true, serverId: "active", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc.mock.calls[0][2].events).toHaveLength(1);
        expect(f.invokePluginRpc.mock.calls[0][2].events[0].stage).toBe("normalize");
    });

    it("deduplicates, limits rate and bounds offline memory to 50 with batches of 20", async () => {
        const f = fixture();
        f.reporter.configure({ enabled: true, serverId: "active", client: null });
        f.capture();
        f.capture();
        for (let line = 2; line <= 30; line++) f.capture(line);
        for (let group = 0; group < 5; group++) {
            f.advance(60001);
            for (let line = 1; line <= 10; line++) f.capture(100 + group * 10 + line);
        }
        f.reporter.configure({ enabled: true, serverId: "active", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc.mock.calls.map((call) => call[2].events.length)).toEqual([20, 20, 10]);
        expect(f.invokePluginRpc.mock.calls[0][2].events[0].stack).toBe("at <frame>:101:2");
    });

    it.each([1, 7, 30])("expires local queued reports after %s days", async (days) => {
        const f = fixture();
        f.reporter.configure({ enabled: true, retentionDays: days, serverId: "active", client: null });
        f.capture();
        f.advance(days * 86400000 + 1);
        f.reporter.configure({ enabled: true, retentionDays: days, serverId: "active", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc).not.toHaveBeenCalled();
    });

    it("discards when disabled or switching hosts and does not fan out", async () => {
        const f = fixture();
        f.reporter.configure({ enabled: true, serverId: "one", client: null });
        f.capture();
        f.reporter.configure({ enabled: false, serverId: "one", client: f.client });
        f.capture(2);
        f.reporter.configure({ enabled: true, serverId: "one", client: null });
        f.capture(3);
        f.reporter.configure({ enabled: true, serverId: "two", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc).not.toHaveBeenCalled();
        await expect(f.reporter.clear("one", f.client)).resolves.toBe(false);
        expect(f.invokePluginRpc).not.toHaveBeenCalled();
    });

    it("isolates network failure without uncertain retry or recursive transport capture", async () => {
        const f = fixture();
        f.invokePluginRpc.mockImplementationOnce(async () => {
            f.reporter.capture(new Error("transport log"), "console");
            throw new Error("offline secret");
        });
        f.reporter.configure({ enabled: true, serverId: "one", client: null });
        f.capture();
        f.reporter.configure({ enabled: true, serverId: "one", client: f.client });
        await expect(f.reporter.flush()).resolves.toBeUndefined();
        f.reporter.configure({ enabled: true, serverId: "one", client: null });
        f.reporter.configure({ enabled: true, serverId: "one", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc).toHaveBeenCalledTimes(1);
    });

    it.each([0, 1])("does not replay a batch when the collector accepts %s events", async (accepted) => {
        const f = fixture();
        f.invokePluginRpc.mockResolvedValue({ accepted });
        f.reporter.configure({ enabled: true, serverId: "active", client: null });
        f.capture(1);
        f.capture(2);
        f.reporter.configure({ enabled: true, serverId: "active", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc.mock.calls[0][2].events.map((event: { id: string }) => event.id))
            .toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]);
        f.reporter.configure({ enabled: true, serverId: "active", client: null });
        f.reporter.configure({ enabled: true, serverId: "active", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc).toHaveBeenCalledTimes(1);
    });

    it("serializes report and clear, discards queued errors and never retries failed clear", async () => {
        const f = fixture();
        let complete!: (value: { accepted: number }) => void;
        f.invokePluginRpc.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        f.reporter.configure({ enabled: true, serverId: "one", client: null });
        f.capture();
        f.reporter.configure({ enabled: true, serverId: "one", client: f.client });
        const clearing = f.reporter.clear("one", f.client);
        expect(f.invokePluginRpc).toHaveBeenCalledTimes(1);
        complete({ accepted: 1 });
        await expect(clearing).resolves.toBe(true);
        expect(f.invokePluginRpc.mock.calls[1][2]).toEqual({ action: "clear" });
        f.invokePluginRpc.mockRejectedValueOnce(new Error("no connection"));
        await expect(f.reporter.clear("one")).resolves.toBe(false);
        expect(f.invokePluginRpc).toHaveBeenCalledTimes(3);
    });

    it("clears the offline local queue without making a duplicate server clear RPC", async () => {
        const f = fixture();
        f.reporter.configure({ enabled: true, serverId: "active", client: null });
        f.capture();
        await expect(f.reporter.clearLocal("other")).resolves.toBe(false);
        await expect(f.reporter.clearLocal("active")).resolves.toBe(true);
        f.reporter.configure({ enabled: true, serverId: "active", client: f.client });
        await f.reporter.flush();
        expect(f.invokePluginRpc).not.toHaveBeenCalled();
        f.capture(2);
        await f.reporter.flush();
        expect(f.invokePluginRpc).toHaveBeenCalledTimes(1);
        expect(f.invokePluginRpc.mock.calls[0][2].action).toBe("report");
    });

    it("local clear waits for in-flight reports before the UI can issue its own server clear", async () => {
        const f = fixture();
        let complete!: (value: { accepted: number }) => void;
        f.invokePluginRpc.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        f.reporter.configure({ enabled: true, serverId: "active", client: f.client });
        f.capture();
        const clear = f.reporter.clearLocal();
        f.capture(2);
        let cleared = false;
        void clear.then(() => { cleared = true; });
        await Promise.resolve();
        expect(cleared).toBe(false);
        complete({ accepted: 1 });
        await expect(clear).resolves.toBe(true);
        await f.reporter.flush();
        expect(f.invokePluginRpc).toHaveBeenCalledTimes(1);
    });
});

describe("global handler ownership", () => {
    it("preserves console arguments, fatal handler and rejection defaults then tears down", () => {
        const prior = vi.fn();
        const previousConsole = vi.fn();
        let current = prior;
        const listeners = new Map<string, (event: any) => void>();
        const target: ErrorHandlerTarget = {
            console: { error: previousConsole },
            ErrorUtils: { getGlobalHandler: () => current, setGlobalHandler: (handler: any) => { current = handler; } },
            addEventListener: (name, handler) => { listeners.set(name, handler); },
            removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
        };
        const capture = vi.fn();
        const teardown = installClientErrorHandlers(target, capture);
        const error = new Error("private");
        target.console.error("private prompt", { token: "private" }, error);
        expect(capture).toHaveBeenCalledExactlyOnceWith(error, "console");
        expect(previousConsole).toHaveBeenCalledWith("private prompt", { token: "private" }, error);
        current(error, true);
        expect(prior).toHaveBeenCalledExactlyOnceWith(error, true);
        const preventDefault = vi.fn();
        listeners.get("unhandledrejection")!({ reason: error, preventDefault });
        expect(capture).toHaveBeenLastCalledWith(error, "rejection");
        expect(preventDefault).not.toHaveBeenCalled();
        teardown();
        expect(current).toBe(prior);
        expect(target.console.error).toBe(previousConsole);
        expect(listeners.size).toBe(0);
    });

    it("does not overwrite newer handlers and isolates capture failures/reentry", () => {
        const prior = vi.fn();
        let current = prior;
        const target: ErrorHandlerTarget = {
            console: { error: prior },
            ErrorUtils: { getGlobalHandler: () => current, setGlobalHandler: (handler: any) => { current = handler; } },
        };
        const capture = vi.fn(() => {
            target.console.error(new Error("nested"));
            throw new Error("capture failed");
        });
        const teardown = installClientErrorHandlers(target, capture);
        expect(() => target.console.error(new Error("outer"))).not.toThrow();
        expect(capture).toHaveBeenCalledTimes(1);
        const newer = vi.fn();
        target.console.error = newer;
        current = newer;
        teardown();
        expect(current).toBe(newer);
        expect(target.console.error).toBe(newer);
    });
});
