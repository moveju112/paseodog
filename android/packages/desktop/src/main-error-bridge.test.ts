import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createMainErrorQueue, installMainErrorCapture, projectMainError } from "./main-error-bridge.js";

describe("main error privacy and lifecycle", () => {
    it("omits messages, paths, arbitrary names, codes, stack getters and console data", () => {
        const error = new Error("secret /home/private token=abc");
        Object.defineProperties(error, {
            name: { value: "SECRET_NAME" },
            code: { value: "SECRET_CODE" },
            stack: { get() { throw new Error("must not read stack"); } },
        });
        const event = projectMainError(error, "console-error");
        expect(event).toEqual({
            source: "desktop-main", kind: "console-error", code: "MAIN_CONSOLE_ERROR",
            name: "Error", frames: [], diagnosticLoss: "message-stack-properties-arguments-omitted",
        });
        expect(projectMainError(new TypeError("private"), "unhandled-rejection").name).toBe("TypeError");
        expect(projectMainError({ private: "data" }, "unhandled-rejection").name).toBe("Error");
    });

    it("keeps a bounded backlog and never replays an uncertain send", () => {
        let ready = false;
        let attempts = 0;
        const queue = createMainErrorQueue(() => {
            if (!ready) return false;
            attempts++;
            throw new Error("uncertain send");
        });
        for (let index = 0; index < 30; index++) queue.capture(new Error("private"), "console-error");
        ready = true;
        queue.flush();
        expect(attempts).toBe(20);
        queue.flush();
        expect(attempts).toBe(20);
        ready = false;
        queue.capture(new Error(), "console-error");
        queue.clear();
        ready = true;
        queue.flush();
        expect(attempts).toBe(20);
    });

    it("observes only Error console arguments, preserves original console and removes listeners", () => {
        const original = console.error;
        const calls: unknown[][] = [];
        const captured: unknown[][] = [];
        const previousListeners = process.listenerCount("uncaughtExceptionMonitor");
        const previousRejections = process.listenerCount("unhandledRejection");
        const previousEmit = process.emit;
        console.error = (...args) => { calls.push(args); };
        const prior = console.error;
        const remove = installMainErrorCapture((...args) => { captured.push(args); });
        const error = new Error("private");
        try {
            console.error("private", { token: "private" }, error);
            expect(calls).toEqual([["private", { token: "private" }, error]]);
            expect(captured).toEqual([[error, "console-error"]]);
            expect(process.listenerCount("unhandledRejection")).toBe(previousRejections);
        } finally {
            remove();
            expect(console.error).toBe(prior);
            expect(process.emit).toBe(previousEmit);
            console.error = original;
        }
        expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(previousListeners);
    });

    it("preserves fatal exit for uncaught exceptions and default/strict unhandled rejections", () => {
        const source = readFileSync(new URL("./main-error-bridge.ts", import.meta.url), "utf8");
        const compiled = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        for (const mode of ["throw", "strict", "warn", "none"]) {
            const child = spawnSync(process.execPath, [
                `--unhandled-rejections=${mode}`, "-e",
                `${compiled}\nexports.installMainErrorCapture((_, kind) => process.stdout.write(kind + "\\n")); Promise.reject(new Error("private"));`,
            ], { encoding: "utf8", timeout: 5000 });
            expect(child.error).toBeUndefined();
            expect(child.status).toBe(mode === "throw" || mode === "strict" ? 1 : 0);
            if (mode !== "strict") expect(child.stdout).toContain("unhandled-rejection");
        }
        const child = spawnSync(process.execPath, ["-e",
            `${compiled}\nexports.installMainErrorCapture((_, kind) => process.stdout.write(kind + "\\n")); throw new Error("private");`,
        ], { encoding: "utf8", timeout: 5000 });
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(1);
        expect(child.stdout).toContain("uncaught-exception");
    });
});
