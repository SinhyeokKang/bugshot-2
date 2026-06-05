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
