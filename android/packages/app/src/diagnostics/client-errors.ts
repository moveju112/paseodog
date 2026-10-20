export type ClientErrorSource = "console" | "global" | "rejection" | "image-picker" | "react" | "desktop-main";
export type PickerStage = "permission" | "desktop" | "recovery" | "normalize" | "launch";
export interface ClientErrorEvent {
    id: string;
    timestamp: number;
    source: ClientErrorSource;
    stage?: PickerStage;
    code: string;
    message: string;
    stack?: string;
    appVersion: string;
    platform: "android" | "ios" | "web" | "desktop";
    osVersion?: string;
}
export interface ClientErrorRpcClient {
    invokePluginRpc(plugin: string, method: string, input: unknown): Promise<unknown>;
}
interface ReporterOptions {
    now: () => number;
    uuid: () => string;
    appVersion: string;
    platform: ClientErrorEvent["platform"];
    osVersion?: string;
}

const sources = new Set(["console", "global", "rejection", "image-picker", "react", "desktop-main"]);
const stages = new Set(["permission", "desktop", "recovery", "normalize", "launch"]);
const errorNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
const knownCodes = new Set([
    "E_PICKER", "ERR_NO_ACTIVITY", "ERR_CANCELED", "E_NO_LIBRARY_PERMISSION", "E_PERMISSION_MISSING",
    "MAIN_CONSOLE_ERROR", "MAIN_UNHANDLED_REJECTION", "MAIN_UNCAUGHT_EXCEPTION",
]);
const safeFrameNames = new Set([
    "useImageAttachmentPicker", "launchImageLibraryAsync", "getPendingResultAsync",
    "normalizePickedImageAssets", "pickImagesWithDesktopDialog", "ensurePermission", "pickImages",
]);

// 네이티브 선택기의 알려진 실패만 고정 코드·문구로 치환하고 원문은 남기지 않는다.
function classifyPickerError(message: unknown) {
    if (typeof message !== "string") return null;
    const boundedMessage = message.slice(0, 4096);
    if (/unregistered ActivityResultLauncher/i.test(boundedMessage)) {
        return { code: "PICKER_LAUNCHER_UNREGISTERED", message: "Image picker activity result launcher is unregistered" };
    }
    if (/Current Activity/i.test(boundedMessage)) {
        return { code: "PICKER_ACTIVITY_UNAVAILABLE", message: "Image picker current activity is unavailable" };
    }
    if (/lateinit property/i.test(boundedMessage)) {
        return { code: "PICKER_UNINITIALIZED", message: "Image picker native initialization is incomplete" };
    }
    return null;
}

// 버전 문자열만 허용하고 사용자 데이터가 섞인 메타데이터를 버린다.
function safeVersion(value: unknown): string | undefined {
    return typeof value === "string" && /^\d{1,4}(?:\.\d{1,4}){0,3}(?:-(?:rc|beta|alpha)\.\d{1,4})?$/.test(value)
        ? value : undefined;
}

// 오류 본문·이름·경로를 전송하지 않고 고정 분류와 위치 숫자만 만든다.
export function sanitizeClientError(error: unknown, source: ClientErrorSource, stage?: PickerStage) {
    if (!sources.has(source) || (stage !== undefined && !stages.has(stage))) return null;
    try {
        const isError = error instanceof Error;
        if (!isError && source !== "image-picker") return null;
        const object = error !== null && typeof error === "object" ? error : null;
        const name = isError && errorNames.has(error.name) ? error.name : "Error";
        const rawCode = object ? Object.getOwnPropertyDescriptor(object, "code")?.value : undefined;
        const code = typeof rawCode === "string" && knownCodes.has(rawCode) ? rawCode : name;
        const pickerDiagnostic = source === "image-picker" && object
            ? classifyPickerError(Object.getOwnPropertyDescriptor(object, "message")?.value)
            : null;
        // 메시지와 함수명에는 프롬프트·토큰이 들어갈 수 있어 allowlist 치환만 사용한다.
        const stack = isError && typeof error.stack === "string"
            ? error.stack.slice(0, 8192).split("\n").slice(1, 21).flatMap((line) => {
                const location = /:(\d{1,7}):(\d{1,7})\)?$/.exec(line.trim());
                if (!location || !/^\s*(?:at\s|[^@\s]+@)/.test(line)) return [];
                const functionName = /^\s*(?:at\s+(?:(?:async|new)\s+)?)?([A-Za-z_$][\w$]*)(?:\s|\(|@)/.exec(line)?.[1];
                const safeName = functionName && safeFrameNames.has(functionName) ? functionName : "<frame>";
                return [`at ${safeName}:${location[1]}:${location[2]}`];
            }).slice(0, 8).join("\n")
            : "";
        return { source, ...(stage ? { stage } : {}), code: pickerDiagnostic?.code ?? code,
            message: pickerDiagnostic?.message ?? (source === "image-picker" ? "Image attachment selection failed" : `${name} captured`),
            ...(stack ? { stack } : {}) };
    } catch {
        return null;
    }
}

// 메모리 큐를 현재 호스트에만 묶고 전송 실패·비활성화가 앱에 전파되지 않게 한다.
export class ClientErrorReporter {
    private queue: ClientErrorEvent[] = [];
    private recent = new Map<string, number>();
    private admitted: number[] = [];
    private enabled = false;
    private retentionDays = 7;
    private serverId: string | null = null;
    private client: ClientErrorRpcClient | null = null;
    private sending: Promise<void> | null = null;
    private clearing = false;
    private transporting = false;
    private capturedErrors = new WeakSet<object>();

    // 시간·UUID와 안전한 앱 메타데이터를 주입한다.
    constructor(private readonly options: ReporterOptions) {}

    // 활성 호스트 변경 시 이전 큐를 폐기하고 연결 복구 시 대기 큐만 보낸다.
    configure(input: { enabled: boolean; retentionDays?: number; serverId: string | null; client: ClientErrorRpcClient | null }) {
        if (!input.enabled || input.serverId !== this.serverId) this.discard();
        this.enabled = input.enabled;
        this.retentionDays = [1, 7, 30].includes(input.retentionDays ?? 7) ? input.retentionDays ?? 7 : 7;
        this.serverId = input.serverId;
        this.client = input.client;
        this.expire();
        void this.flush();
    }

    // 보존 기간을 지난 항목과 중복·속도 제한 기록을 함께 정리한다.
    private expire() {
        const now = this.options.now();
        this.queue = this.queue.filter((event) => event.timestamp > now - this.retentionDays * 86400000);
        this.admitted = this.admitted.filter((time) => time > now - 60000);
        for (const [key, time] of this.recent) if (time <= now - 60000) this.recent.delete(key);
    }

    // 민감한 원본은 보관하지 않고 분당 10개·동일 오류 1개·총 50개만 유지한다.
    capture(error: unknown, source: ClientErrorSource, stage?: PickerStage) {
        if (!this.enabled || this.clearing || (this.transporting && source === "console") || !this.serverId) return;
        const safe = sanitizeClientError(error, source, stage);
        if (!safe) return;
        if (error !== null && typeof error === "object" && this.capturedErrors.has(error)) return;
        this.expire();
        const now = this.options.now();
        const key = JSON.stringify(safe);
        if (this.recent.has(key) || this.admitted.length >= 10) return;
        try {
            const id = this.options.uuid();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return;
            this.queue.push({ ...safe, id, timestamp: now,
                appVersion: safeVersion(this.options.appVersion) ?? "0",
                platform: this.options.platform,
                ...(safeVersion(this.options.osVersion) ? { osVersion: this.options.osVersion } : {}) });
            this.queue = this.queue.slice(-50);
            this.recent.set(key, now);
            this.admitted.push(now);
            if (error !== null && typeof error === "object") this.capturedErrors.add(error);
            void this.flush();
        } catch {
            // 진단 실패는 원래 오류 처리에 영향을 주지 않는다.
        }
    }

    // 한 번에 최대 20개만 직렬 전송하며 결과가 불확실한 배치는 재전송하지 않는다.
    flush(): Promise<void> {
        if (this.sending) return this.sending;
        if (!this.enabled || this.clearing || !this.client || !this.serverId) return Promise.resolve();
        this.expire();
        if (!this.queue.length) return Promise.resolve();
        const client = this.client;
        const serverId = this.serverId;
        // 비동기 진단 전송 중 발생한 실패는 로그 없이 종료한다.
        const send = async () => {
            while (this.enabled && !this.clearing && this.client === client && this.serverId === serverId) {
                this.expire();
                const events = this.queue.splice(0, 20);
                if (!events.length) break;
                try {
                    this.transporting = true;
                    const result = await client.invokePluginRpc("paseodog-provider", "client-errors", { action: "report", events });
                    if (!result || typeof result !== "object" || !("accepted" in result) ||
                        !Number.isInteger(result.accepted) || Number(result.accepted) < 0 ||
                        Number(result.accepted) > events.length) break;
                } catch {
                    break;
                } finally {
                    this.transporting = false;
                }
            }
        };
        this.sending = send().finally(() => {
            this.sending = null;
            if (this.client !== client || this.queue.length > 0) void this.flush();
        });
        return this.sending;
    }

    // 원본이나 로컬 보고서가 남지 않게 큐와 제한 기록을 비운다.
    private discard() {
        this.queue = [];
        this.recent.clear();
        this.admitted = [];
        this.capturedErrors = new WeakSet<object>();
    }

    // 서버 RPC 없이 로컬 큐만 비우고 이미 시작한 전송이 끝날 때까지 새 캡처를 막는다.
    async clearLocal(serverId?: string): Promise<boolean> {
        if (this.clearing || (serverId !== undefined && serverId !== this.serverId)) return false;
        this.discard();
        this.clearing = true;
        try {
            await this.sending;
            return true;
        } finally {
            this.clearing = false;
        }
    }

    // 로컬 큐를 즉시 지우고 진행 중 전송 뒤 현재 연결 호스트만 한 번 지운다.
    async clear(serverId: string, client?: ClientErrorRpcClient | null): Promise<boolean> {
        if (this.clearing || serverId !== this.serverId || (client && client !== this.client)) return false;
        this.discard();
        const activeClient = this.client;
        this.clearing = true;
        try {
            await this.sending;
            if (!activeClient || this.client !== activeClient || this.serverId !== serverId) return false;
            const result = await activeClient.invokePluginRpc("paseodog-provider", "client-errors", { action: "clear" });
            return !!result && typeof result === "object" && "accepted" in result &&
                Number.isInteger(result.accepted) && Number(result.accepted) >= 0;
        } catch {
            return false;
        } finally {
            this.clearing = false;
        }
    }
}
