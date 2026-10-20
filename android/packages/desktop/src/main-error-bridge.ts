import { isNativeError } from "node:util/types";

export interface DesktopMainErrorEvent {
    source: "desktop-main";
    kind: "console-error" | "unhandled-rejection" | "uncaught-exception";
    code: "MAIN_CONSOLE_ERROR" | "MAIN_UNHANDLED_REJECTION" | "MAIN_UNCAUGHT_EXCEPTION";
    name: "Error" | "TypeError" | "RangeError" | "ReferenceError" | "SyntaxError" | "URIError" | "EvalError" | "AggregateError";
    frames: [];
    diagnosticLoss: "message-stack-properties-arguments-omitted";
}

// 오류의 사용자 문자열을 읽지 않고 고정 분류만 IPC에 전달한다.
export function projectMainError(value: unknown, kind: DesktopMainErrorEvent["kind"]): DesktopMainErrorEvent {
    let name: DesktopMainErrorEvent["name"] = "Error";
    if (isNativeError(value)) {
        // stack 접근은 prepareStackTrace 실행도 유발하므로 하지 않는다.
        try {
            const prototype = Object.getPrototypeOf(value);
            const descriptor = Object.getOwnPropertyDescriptor(value, "name")
                ?? (prototype && Object.getOwnPropertyDescriptor(prototype, "name"));
            const candidate = descriptor?.value;
            if (["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"].includes(candidate)) {
                name = candidate;
            }
        } catch {
            // 사용자 정의 접근자와 프록시 실패도 원래 오류 처리를 방해하지 않는다.
        }
    }
    return {
        source: "desktop-main",
        kind,
        code: kind === "console-error" ? "MAIN_CONSOLE_ERROR"
            : kind === "unhandled-rejection" ? "MAIN_UNHANDLED_REJECTION" : "MAIN_UNCAUGHT_EXCEPTION",
        name,
        frames: [],
        diagnosticLoss: "message-stack-properties-arguments-omitted",
    };
}

// 구독 전 최대 20건을 보관하고 전송 결과가 불확실한 이벤트는 재시도하지 않는다.
export function createMainErrorQueue(deliver: (event: DesktopMainErrorEvent) => boolean) {
    const pending: DesktopMainErrorEvent[] = [];
    // 활성 앱 구독이 있으면 보관 이벤트를 한 번씩 전달한다.
    const flush = () => {
        while (pending.length) {
            const event = pending[0]!;
            try {
                if (!deliver(event)) return;
            } catch {
                // 전송 예외는 전달 여부가 불확실하므로 재전송하지 않는다.
            }
            pending.shift();
        }
    };
    return {
        // 모든 입력을 고정 분류로 축소한 뒤 큐에 넣는다.
        capture(value: unknown, kind: DesktopMainErrorEvent["kind"]) {
            pending.push(projectMainError(value, kind));
            if (pending.length > 20) pending.shift();
            flush();
        },
        flush,
        // 종료 시 메모리에 남은 이벤트를 폐기한다.
        clear() { pending.length = 0; },
    };
}

// 관찰만 추가하고 console 반환값과 Node의 치명적 예외 정책을 유지한다.
export function installMainErrorCapture(capture: (value: unknown, kind: DesktopMainErrorEvent["kind"]) => void) {
    const originalConsoleError = console.error;
    const originalEmit = process.emit;
    // 수집기 실패는 원래 로깅과 예외 처리를 변경하지 않는다.
    const observe = (value: unknown, kind: DesktopMainErrorEvent["kind"]) => {
        try { capture(value, kind); } catch { /* 관찰 실패는 전파하지 않는다. */ }
    };
    // 문자열과 일반 객체는 수집하지 않고 Error 인자만 관찰한다.
    const consoleError: typeof console.error = function (this: Console, ...args) {
        for (const value of args) {
            if (isNativeError(value)) observe(value, "console-error");
        }
        return Reflect.apply(originalConsoleError, this, args);
    };
    // rejection 리스너를 등록하지 않아 기본 throw 정책의 리스너 유무 판정을 보존한다.
    const emit = function (this: NodeJS.Process, event: string | symbol, ...args: unknown[]) {
        if (event === "unhandledRejection") observe(args[0], "unhandled-rejection");
        return Reflect.apply(originalEmit, this, [event, ...args]);
    } as typeof process.emit;
    // monitor는 uncaughtException 처리기를 설치하지 않으므로 종료를 막지 않는다.
    const monitor = (error: Error) => observe(error, "uncaught-exception");
    console.error = consoleError;
    process.emit = emit;
    process.on("uncaughtExceptionMonitor", monitor);
    // 자신이 설치한 래퍼와 리스너만 해제한다.
    return () => {
        if (console.error === consoleError) console.error = originalConsoleError;
        if (process.emit === emit) process.emit = originalEmit;
        process.removeListener("uncaughtExceptionMonitor", monitor);
    };
}
