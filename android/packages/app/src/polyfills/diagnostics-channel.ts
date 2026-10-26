// 브라우저·Hermes 번들용 node:diagnostics_channel 대체 모듈.
// lru-cache 11.3+를 내장한 @xterm/addon-ligatures가 channel()/tracingChannel()을 호출한다.
// 구독자가 없는 채널로 동작해 계측만 생략한다.

interface DiagnosticsChannel {
  readonly name: string;
  readonly hasSubscribers: boolean;
  publish(message: unknown): void;
  subscribe(listener: unknown): void;
  unsubscribe(listener: unknown): boolean;
}

interface TracingChannel {
  readonly hasSubscribers: boolean;
  subscribe(handlers: unknown): void;
  unsubscribe(handlers: unknown): boolean;
  traceSync<T>(
    fn: (...args: unknown[]) => T,
    context?: unknown,
    thisArg?: unknown,
    ...args: unknown[]
  ): T;
  tracePromise<T>(
    fn: (...args: unknown[]) => Promise<T>,
    context?: unknown,
    thisArg?: unknown,
    ...args: unknown[]
  ): Promise<T>;
  traceCallback<T>(
    fn: (...args: unknown[]) => T,
    position?: number,
    context?: unknown,
    thisArg?: unknown,
    ...args: unknown[]
  ): T;
}

export function channel(name: string): DiagnosticsChannel {
  return {
    name,
    hasSubscribers: false,
    publish() {},
    subscribe() {},
    unsubscribe() {
      return false;
    },
  };
}

export function tracingChannel(_name: string): TracingChannel {
  return {
    hasSubscribers: false,
    subscribe() {},
    unsubscribe() {
      return false;
    },
    traceSync(fn, _context, thisArg, ...args) {
      return fn.apply(thisArg, args);
    },
    tracePromise(fn, _context, thisArg, ...args) {
      return fn.apply(thisArg, args);
    },
    traceCallback(fn, _position, _context, thisArg, ...args) {
      return fn.apply(thisArg, args);
    },
  };
}

export function hasSubscribers(_name: string): boolean {
  return false;
}

export function subscribe(_name: string, _listener: unknown): void {}

export function unsubscribe(_name: string, _listener: unknown): boolean {
  return false;
}

export default { channel, tracingChannel, hasSubscribers, subscribe, unsubscribe };
