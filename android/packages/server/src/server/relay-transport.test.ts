import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import pino from "pino";
import { createClientChannel, type Transport } from "@getpaseo/relay/e2ee";
import { exportPublicKey, generateKeyPair } from "@getpaseo/relay";
import { startRelayTransport } from "./relay-transport";

function createMockLogger() {
  const messages: { level: "debug" | "info" | "warn" | "error"; args: unknown[] }[] = [];
  const logger = {
    messages,
    child: () => logger,
    debug: (...args: unknown[]) => messages.push({ level: "debug", args }),
    info: (...args: unknown[]) => messages.push({ level: "info", args }),
    warn: (...args: unknown[]) => messages.push({ level: "warn", args }),
    error: (...args: unknown[]) => messages.push({ level: "error", args }),
  };
  return logger;
}

type TestLogger = ReturnType<typeof createMockLogger>;

function hasLogMessage(logger: TestLogger, level: "info" | "warn", message: string): boolean {
  return logger.messages.some((entry) => {
    return entry.level === level && entry.args.some((arg) => arg === message);
  });
}

class FakeRelayWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeRelayWebSocket.CONNECTING;
  sent: Array<string | Uint8Array | ArrayBuffer> = [];
  terminateCalls = 0;
  pingCalls = 0;
  deferSendCompletion = false;
  onSend: ((data: string | Uint8Array | ArrayBuffer) => void) | null = null;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  private readonly pendingSendCallbacks: Array<(error?: Error) => void> = [];

  constructor(readonly url: string) {}

  on(event: string, listener: (...args: unknown[]) => void) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  once(event: string, listener: (...args: unknown[]) => void) {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  close(code?: number, reason?: string) {
    this.readyState = FakeRelayWebSocket.CLOSED;
    this.emit("close", code ?? 1000, reason ?? "");
  }

  terminate() {
    this.terminateCalls += 1;
    this.readyState = FakeRelayWebSocket.CLOSED;
    this.emit("close", 1006, "");
  }

  send(data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) {
    if (this.readyState !== FakeRelayWebSocket.OPEN) {
      throw new Error(`WebSocket not open (readyState=${this.readyState})`);
    }
    this.sent.push(data);
    this.onSend?.(data);
    if (!callback) return;
    if (this.deferSendCompletion) {
      this.pendingSendCallbacks.push(callback);
      return;
    }
    callback();
  }

  completeNextSend() {
    this.pendingSendCallbacks.shift()?.();
  }

  ping() {
    if (this.readyState !== FakeRelayWebSocket.OPEN) {
      throw new Error(`WebSocket not open (readyState=${this.readyState})`);
    }
    this.pingCalls += 1;
  }

  open() {
    this.readyState = FakeRelayWebSocket.OPEN;
    this.emit("open");
  }

  message(data: unknown, isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    this.emit("message", data, isBinary);
  }

  pong() {
    this.emit("pong");
  }

  private off(event: string, listener: (...args: unknown[]) => void) {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      handlers.filter((handler) => handler !== listener),
    );
  }

  private emit(event: string, ...args: unknown[]) {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers.slice()) {
      handler(...args);
    }
  }
}

function createFakeWebSockets() {
  const sockets: FakeRelayWebSocket[] = [];
  return {
    sockets,
    createWebSocket(url: string) {
      const socket = new FakeRelayWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

describe("relay-transport control lifecycle", () => {
  const controllers: Array<{ stop: () => Promise<void> }> = [];
  let relay: ReturnType<typeof createFakeWebSockets>;

  beforeEach(() => {
    relay = createFakeWebSockets();
  });

  afterEach(async () => {
    await Promise.all(controllers.map((controller) => controller.stop()));
    controllers.length = 0;
    vi.useRealTimers();
  });

  test("retries a data connection that fails before opening without another control message", async () => {
    vi.useFakeTimers();
    const attachedSockets: unknown[] = [];
    const controller = startRelayTransport({
      logger: pino({ level: "silent" }),
      attachSocket: async (socket) => {
        attachedSockets.push(socket);
      },
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: ["retry"] }));
    const failed = relay.sockets[1];
    failed.close(1006, "");

    await vi.advanceTimersByTimeAsync(999);
    expect(relay.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.sockets).toHaveLength(3);
    const replacement = relay.sockets[2];
    expect(replacement.url).toBe(failed.url);
    replacement.open();
    expect(attachedSockets).toEqual([replacement]);
    expect(control.terminateCalls).toBe(0);
  });

  test("bounds data retries and does not duplicate them on repeated control notifications", async () => {
    vi.useFakeTimers();
    const controller = startRelayTransport({
      logger: pino({ level: "silent" }),
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const control = relay.sockets[0];
    control.open();
    const connected = JSON.stringify({ type: "connected", connectionId: "retry" });
    control.message(connected);

    for (const delayMs of [1_000, 2_000, 3_000]) {
      const attempts = relay.sockets.length;
      relay.sockets.at(-1)?.close(1006, "");
      control.message(connected);
      expect(relay.sockets).toHaveLength(attempts);
      await vi.advanceTimersByTimeAsync(delayMs);
      expect(relay.sockets).toHaveLength(attempts + 1);
    }
    relay.sockets.at(-1)?.close(1006, "");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.sockets).toHaveLength(5);
  });

  test.each(["disconnected", "stop"] as const)(
    "cancels a pending data retry on %s",
    async (event) => {
      vi.useFakeTimers();
      const controller = startRelayTransport({
        logger: pino({ level: "silent" }),
        attachSocket: async () => {},
        relayEndpoint: "relay.paseo.sh:443",
        relayUseTls: true,
        serverId: "srv_test",
        createWebSocket: relay.createWebSocket,
      });
      controllers.push(controller);
      const control = relay.sockets[0];
      control.open();
      control.message(JSON.stringify({ type: "connected", connectionId: "retry" }));
      relay.sockets[1].close(1006, "");
      if (event === "stop") {
        await controller.stop();
      } else {
        control.message(JSON.stringify({ type: "disconnected", connectionId: "retry" }));
      }
      await vi.advanceTimersByTimeAsync(5_000);
      expect(relay.sockets).toHaveLength(2);
    },
  );

  test("waits for control synchronization instead of retrying an unknown client", async () => {
    vi.useFakeTimers();
    const controller = startRelayTransport({
      logger: pino({ level: "silent" }),
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: "retry" }));
    relay.sockets[1].close(1006, "");
    control.close(1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.sockets).toHaveLength(3);
    const nextControl = relay.sockets[2];
    expect(new URL(nextControl.url).searchParams.has("connectionId")).toBe(false);
    nextControl.open();
    nextControl.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.sockets).toHaveLength(3);
  });

  test("does not retry an established data socket after it closes", async () => {
    vi.useFakeTimers();
    const controller = startRelayTransport({
      logger: pino({ level: "silent" }),
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: "established" }));
    relay.sockets[1].open();
    relay.sockets[1].close(1006, "");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.sockets).toHaveLength(2);
  });

  test("does not retry an old in-flight data socket after control ownership changes", async () => {
    vi.useFakeTimers();
    const controller = startRelayTransport({
      logger: pino({ level: "silent" }),
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: "old-client" }));
    const oldData = relay.sockets[1];
    control.close(1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    const nextControl = relay.sockets[2];
    nextControl.open();
    nextControl.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    oldData.close(1006, "");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.sockets).toHaveLength(3);
  });

  test("ignores a stale socket close after its data replacement starts", async () => {
    vi.useFakeTimers();
    const controller = startRelayTransport({
      logger: pino({ level: "silent" }),
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: "retry" }));
    const failed = relay.sockets[1];
    failed.close(1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    const replacement = relay.sockets[2];
    failed.close(1006, "");
    control.message(JSON.stringify({ type: "connected", connectionId: "retry" }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.sockets).toHaveLength(3);
    replacement.open();
    expect(replacement.readyState).toBe(FakeRelayWebSocket.OPEN);
  });

  test("does not retry a pending data socket explicitly closed by a client departure", async () => {
    vi.useFakeTimers();
    const controller = startRelayTransport({
      logger: pino({ level: "silent" }),
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: "departed" }));
    control.message(JSON.stringify({ type: "disconnected", connectionId: "departed" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.sockets).toHaveLength(2);
    expect(relay.sockets[1].readyState).toBe(FakeRelayWebSocket.CLOSED);
  });

  test("releases a stalled encrypted data connection without restarting control", async () => {
    vi.useFakeTimers();
    let attachments = 0;
    controllers.push(
      startRelayTransport({
        logger: pino({ level: "silent" }),
        attachSocket: async () => {
          attachments += 1;
        },
        relayEndpoint: "relay.paseo.sh:443",
        relayUseTls: true,
        serverId: "srv_test",
        daemonKeyPair: generateKeyPair(),
        createWebSocket: relay.createWebSocket,
      }),
    );
    const control = relay.sockets[0];
    control.open();
    const connected = JSON.stringify({ type: "connected", connectionId: "stalled" });
    control.message(connected);
    const stalled = relay.sockets[1];
    stalled.open();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(stalled.terminateCalls).toBe(1);
    expect(attachments).toBe(0);
    expect(control.terminateCalls).toBe(0);
    control.message(connected);
    expect(relay.sockets).toHaveLength(3);
    expect(relay.sockets[2].url).toBe(stalled.url);
  });

  test("logs relay_control_connected only after first valid control message", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    expect(control).toBeDefined();

    control.open();
    expect(hasLogMessage(logger, "info", "relay_control_connected")).toBe(false);
    expect(control.pingCalls).toBeGreaterThan(0);

    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    expect(hasLogMessage(logger, "info", "relay_control_connected")).toBe(true);
  });

  test("terminates and reconnects when control socket opens but never becomes ready", () => {
    vi.useFakeTimers();
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const firstControl = relay.sockets[0];
    firstControl.open();

    vi.advanceTimersByTime(8_000);
    expect(hasLogMessage(logger, "warn", "relay_control_ready_timeout_terminating")).toBe(true);
    expect(firstControl.terminateCalls).toBe(1);

    vi.advanceTimersByTime(1_000);
    expect(relay.sockets.length).toBeGreaterThanOrEqual(2);
  });

  test("terminates stale control sockets in under one minute", () => {
    vi.useFakeTimers();
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    logger.messages.length = 0;

    vi.advanceTimersByTime(40_000);
    expect(hasLogMessage(logger, "warn", "relay_control_stale_terminating")).toBe(true);
    expect(control.terminateCalls).toBe(1);
  });

  test("passes stable relay external session metadata when attaching data socket", async () => {
    const logger = createMockLogger();
    const attachedSockets: unknown[] = [];
    const attachedMetadata: unknown[] = [];
    const attachSocket = async (socket: unknown, metadata: unknown) => {
      attachedSockets.push(socket);
      attachedMetadata.push(metadata);
    };
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket,
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }));

    const dataSocket = relay.sockets[1];
    expect(dataSocket).toBeDefined();
    dataSocket.open();

    await Promise.resolve();

    expect(attachedSockets).toEqual([dataSocket]);
    expect(attachedMetadata).toEqual([
      {
        transport: "relay",
        externalSessionKey: "session:clt_test",
        relayConnectionId: "clt_test",
      },
    ]);
  });

  test("encrypted sends wait for the physical data socket callback", async () => {
    const logger = createMockLogger();
    const daemonKeyPair = generateKeyPair();
    let resolveAttached: ((socket: unknown) => void) | undefined;
    const attached = new Promise<unknown>((resolve) => {
      resolveAttached = resolve;
    });
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async (socket) => resolveAttached?.(socket),
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      daemonKeyPair,
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }), false);
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }), false);

    const dataSocket = relay.sockets[1];
    dataSocket.deferSendCompletion = true;
    dataSocket.open();
    let clientTransport: Transport;
    clientTransport = {
      send: (data) => dataSocket.message(data, data instanceof ArrayBuffer),
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    dataSocket.onSend = (data) => {
      clientTransport.onmessage?.({
        data: data instanceof Uint8Array ? data.slice().buffer : data,
        isBinary: data instanceof ArrayBuffer || data instanceof Uint8Array,
      });
    };
    let resolveClientOpen: (() => void) | undefined;
    const clientOpen = new Promise<void>((resolve) => {
      resolveClientOpen = resolve;
    });
    await createClientChannel(clientTransport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveClientOpen?.(),
    });

    let attachedCompleted = false;
    void attached.then(() => {
      attachedCompleted = true;
      return undefined;
    });
    await clientOpen;
    await Promise.resolve();
    expect(attachedCompleted).toBe(false);
    dataSocket.completeNextSend();
    const encryptedSocket = (await attached) as {
      send: (data: Uint8Array) => void | Promise<void>;
    };
    let completed = false;

    const sending = Promise.resolve(encryptedSocket.send(new Uint8Array([1, 2, 3]))).then(() => {
      completed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    dataSocket.completeNextSend();
    await sending;
    expect(completed).toBe(true);
  });

  test("uses relayUseTls for control and data socket URLs", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "[::1]:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }));

    expect(relay.sockets[0]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
    expect(relay.sockets[1]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
  });
});
