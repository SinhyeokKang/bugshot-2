// console-recorder.ts에서 IIFE 자가호출하기 때문에 테스트가 필요한 순수 함수는 별도 파일로 분리.

export interface ErrorEventLike {
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}

export function formatErrorEvent(e: ErrorEventLike): { args: string; stack?: string } {
  const message = e.message || "Error";
  const loc = e.filename
    ? ` at ${e.filename}:${e.lineno ?? "?"}:${e.colno ?? "?"}`
    : "";
  const stack = e.error instanceof Error ? e.error.stack : undefined;
  return { args: `Uncaught ${message}${loc}`, stack };
}

export function formatRejectionReason(reason: unknown): { args: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      args: `Unhandled promise rejection: ${reason.name}: ${reason.message}`,
      stack: reason.stack,
    };
  }
  if (reason === undefined) return { args: "Unhandled promise rejection: undefined" };
  if (reason === null) return { args: "Unhandled promise rejection: null" };
  if (typeof reason === "string") return { args: `Unhandled promise rejection: ${reason}` };
  if (typeof reason === "number" || typeof reason === "boolean") {
    return { args: `Unhandled promise rejection: ${String(reason)}` };
  }
  let str: string;
  try {
    const seen = new WeakSet<object>();
    str = JSON.stringify(reason, (_k, v) => {
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    });
  } catch {
    str = String(reason);
  }
  return { args: `Unhandled promise rejection: ${str}` };
}

export function shouldCaptureAssertion(condition: unknown): boolean {
  return !condition;
}

export const ARG_CAP = 10 * 1024;

// MAIN world에서 페이지가 console.*에 넘긴 임의 값을 직렬화한다. 페이지 객체의
// throwing getter·커스텀 toString/Symbol.toPrimitive·Proxy trap이 throw해도
// 절대 밖으로 전파하지 않는다 — wrap된 console.* 호출(=페이지 코드)이 깨지면 안 되므로
// 최종 try/catch로 감싼다 (network fetch/XHR wrap의 record try/catch와 대칭).
export function safeStringify(value: unknown, depth: number): string {
  try {
    if (depth > 5) return "[...]";
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
    if (value instanceof Error) {
      return value.stack || `${value.name}: ${value.message}`;
    }
    if (value instanceof RegExp) return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (typeof Node !== "undefined" && value instanceof Node) {
      const el = value as Element;
      if (el.tagName) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className && typeof el.className === "string"
          ? `.${el.className.split(/\s+/).filter(Boolean).join(".")}`
          : "";
        return `<${tag}${id}${cls}>`;
      }
      return `[${value.nodeName}]`;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      const items = value.slice(0, 20).map((v) => safeStringify(v, depth + 1));
      if (value.length > 20) items.push(`...+${value.length - 20}`);
      return `[${items.join(", ")}]`;
    }
    try {
      const seen = new Set<unknown>();
      return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === "object") {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
          if (typeof Node !== "undefined" && val instanceof Node) {
            return safeStringify(val, depth + 1);
          }
        }
        return val;
      }, 2);
    } catch {
      return String(value);
    }
  } catch {
    return "[unserializable]";
  }
}

export function serializeArgs(args: unknown[]): string {
  const parts = args.map((a) => safeStringify(a, 0));
  const joined = parts.join(" ");
  if (joined.length > ARG_CAP) {
    return joined.slice(0, ARG_CAP) + "...";
  }
  return joined;
}

// --- error/warn arm-스코프 wrap 라이프사이클 (단위 테스트 대상) ---
// IIFE 클로저는 import 불가라 install/restore 로직까지 순수 함수로 끌어내 멱등성·복원
// 안전성을 단위로 검증한다. console-recorder.ts는 실제 console·상태 객체를 넘겨 호출만 한다.

export type ConsoleFn = (...args: unknown[]) => void;
type RecordFn = (level: "error" | "warn", args: unknown[]) => void;
interface EwTarget {
  error: ConsoleFn;
  warn: ConsoleFn;
}
// prior: arm 시점의 직전 메서드(페이지 모니터링 wrapper일 수 있음), ours: 우리가 설치한 wrapper.
export interface EwState {
  installed: boolean;
  prior: EwTarget | null;
  ours: EwTarget | null;
}

// native를 먼저 동기 호출(페이지 동작·DevTools 출력 보존)한 뒤 record를 try/catch로 격리해
// 위임한다 — record(혹은 captureStack)가 throw해도 페이지의 console.* 호출자로 전파 금지(무간섭).
export function makeConsoleWrapper(
  native: ConsoleFn,
  level: "error" | "warn",
  record: RecordFn,
): ConsoleFn {
  return function (...args: unknown[]) {
    native(...args);
    try {
      record(level, args);
    } catch {
      // 무간섭 원칙: 캡처 실패가 페이지 코드를 깨면 안 된다.
    }
  };
}

// 멱등 설치: arm 시점의 현재 error/warn(페이지 Sentry 등이 덧씌운 wrapper 포함)을 prior로 스냅샷하고
// 그 prior를 호출하는 wrapper를 설치한다 — prior를 init-native가 아닌 arm 시점값으로 잡아야
// 페이지 모니터링을 우회·파괴하지 않는다. 이미 installed면 no-op(setSentinel 다회 호출 대비).
export function installConsoleWrap(
  target: EwTarget,
  state: EwState,
  makeWrapper: (native: ConsoleFn, level: "error" | "warn") => ConsoleFn,
): void {
  if (state.installed) return;
  const prior: EwTarget = {
    error: target.error.bind(target),
    warn: target.warn.bind(target),
  };
  const ours: EwTarget = {
    error: makeWrapper(prior.error, "error"),
    warn: makeWrapper(prior.warn, "warn"),
  };
  target.error = ours.error;
  target.warn = ours.warn;
  state.prior = prior;
  state.ours = ours;
  state.installed = true;
}

// 안전 복원: 메서드가 여전히 우리 wrapper면 prior로 되돌린다(페이지가 그 위에 또 덧씌웠으면 보존).
// init-native가 아닌 prior 복원이라 arm 전 설치된 페이지 wrapper가 살아남는다. 가드는 항상 내림.
export function restoreConsoleWrap(target: EwTarget, state: EwState): void {
  const { ours, prior } = state;
  if (ours && prior) {
    if (target.error === ours.error) target.error = prior.error;
    if (target.warn === ours.warn) target.warn = prior.warn;
  }
  state.installed = false;
  state.prior = null;
  state.ours = null;
}
