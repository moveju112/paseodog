import type { ClientErrorSource } from "./client-errors";

type Handler = (error: unknown, fatal?: boolean) => void;
export interface ErrorHandlerTarget {
    console: { error: (...args: unknown[]) => void };
    ErrorUtils?: { getGlobalHandler(): Handler; setGlobalHandler(handler: Handler): void };
    addEventListener?: (type: string, handler: (event: any) => void) => void;
    removeEventListener?: (type: string, handler: (event: any) => void) => void;
}

// 기존 전역·콘솔 처리기를 보존하고 Error 객체만 안전한 캡처 경로로 보낸다.
export function installClientErrorHandlers(
    target: ErrorHandlerTarget,
    capture: (error: unknown, source: ClientErrorSource) => void,
): () => void {
    let capturing = false;
    // 캡처 오류와 재진입은 무시하여 콘솔·전송 루프를 차단한다.
    const safeCapture = (error: unknown, source: ClientErrorSource) => {
        if (capturing) return;
        capturing = true;
        try { capture(error, source); } catch { /* 진단 실패를 격리한다. */ }
        finally { capturing = false; }
    };
    const previousConsole = target.console.error;
    // 자유 형식 콘솔 문자열은 검사하거나 전송하지 않는다.
    const consoleHandler = (...args: unknown[]) => {
        for (const error of args) {
            try { if (error instanceof Error) safeCapture(error, "console"); } catch { /* 프록시 입력을 버린다. */ }
        }
        previousConsole.apply(target.console, args);
    };
    const errorUtils = target.ErrorUtils;
    const previousGlobal = errorUtils?.getGlobalHandler();
    // 치명 오류의 기존 동작을 유지하되 네이티브 크래시 복구는 시도하지 않는다.
    const globalHandler: Handler = (error, fatal) => {
        safeCapture(error, "global");
        previousGlobal?.(error, fatal);
    };
    // 거부 이벤트는 취소하지 않아 기존 브라우저·런타임 처리가 유지된다.
    const rejectionHandler = (event: { reason?: unknown }) => safeCapture(event.reason, "rejection");
    // 웹 오류 본문 대신 실제 Error 객체만 수집한다.
    const webErrorHandler = (event: { error?: unknown }) => safeCapture(event.error, "global");
    target.console.error = consoleHandler;
    errorUtils?.setGlobalHandler(globalHandler);
    target.addEventListener?.("unhandledrejection", rejectionHandler);
    target.addEventListener?.("error", webErrorHandler);
    // 다른 라이브러리의 후속 처리기를 덮어쓰지 않고 소유한 처리기만 해제한다.
    return () => {
        if (target.console.error === consoleHandler) target.console.error = previousConsole;
        if (errorUtils?.getGlobalHandler() === globalHandler && previousGlobal) errorUtils.setGlobalHandler(previousGlobal);
        target.removeEventListener?.("unhandledrejection", rejectionHandler);
        target.removeEventListener?.("error", webErrorHandler);
    };
}
