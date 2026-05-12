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
