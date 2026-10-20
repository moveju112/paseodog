import type { DesktopMainErrorEvent } from "@/desktop/host";
import type { ClientErrorSource } from "./client-errors";

interface DesktopErrorBridge {
    onError(handler: (event: DesktopMainErrorEvent) => void): () => void;
}
const mainErrorKinds = {
    "console-error": "MAIN_CONSOLE_ERROR",
    "unhandled-rejection": "MAIN_UNHANDLED_REJECTION",
    "uncaught-exception": "MAIN_UNCAUGHT_EXCEPTION",
} as const;
const mainErrorNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);

// 신뢰 경계에서 메인 프로세스의 고정 분류만 재검증하고 원문·속성·스택은 재사용하지 않는다.
export function captureDesktopMainError(
    event: unknown,
    capture: (error: unknown, source: ClientErrorSource) => void,
): void {
    try {
        if (!event || typeof event !== "object") return;
        const input = event as DesktopMainErrorEvent;
        if (input.source !== "desktop-main" || !Object.hasOwn(mainErrorKinds, input.kind) ||
            mainErrorKinds[input.kind] !== input.code || !mainErrorNames.has(input.name)) return;
        const error = new Error("Desktop main process error");
        error.name = input.name;
        // 렌더러의 스택을 메인 프로세스의 스택으로 오인하지 않게 제거한다.
        error.stack = undefined;
        Object.assign(error, { code: input.code });
        capture(error, "desktop-main");
    } catch {
        // 브리지 입력이나 캡처 실패가 앱 수명을 바꾸지 않게 격리한다.
    }
}

// 좁은 데스크톱 브리지 구독을 앱 수명에 묶고 실패·해제 예외를 외부에 전파하지 않는다.
export function subscribeDesktopClientErrors(
    bridge: DesktopErrorBridge | undefined,
    capture: (error: unknown, source: ClientErrorSource) => void,
): () => void {
    try {
        const unsubscribe = bridge?.onError((event) => captureDesktopMainError(event, capture));
        return () => {
            try { unsubscribe?.(); } catch { /* 브리지 해제 실패는 무시한다. */ }
        };
    } catch {
        return () => {};
    }
}
