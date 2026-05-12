import {
  formatErrorEvent,
  formatRejectionReason,
  shouldCaptureAssertion,
} from "./console-recorder-helpers";

function consoleRecorderScript(): void {
  const CTRL_KEY = "__bugshot_console_ctrl__";
  if ((window as any)[CTRL_KEY]) return;

  const MAX_ENTRIES = 2000;
  const ARG_CAP = 10 * 1024;
  const SET_SENTINEL_EVENT = "__bugshot_console_setSentinel__";

  type Level = "log" | "info" | "warn" | "error" | "debug";

  interface CapturedEntry {
    id: string;
    level: Level;
    timestamp: number;
    args: string;
    stack?: string;
    pageUrl: string;
  }

  const buffer: CapturedEntry[] = [];
  let totalSeen = 0;
  let recording = false;

  function genId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `cl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function safeStringify(value: unknown, depth: number): string {
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
  }

  function serializeArgs(args: unknown[]): string {
    const parts = args.map((a) => safeStringify(a, 0));
    const joined = parts.join(" ");
    if (joined.length > ARG_CAP) {
      return joined.slice(0, ARG_CAP) + "...";
    }
    return joined;
  }

  function captureStack(): string | undefined {
    const err = new Error();
    const stack = err.stack;
    if (!stack) return undefined;
    const lines = stack.split("\n");
    const filtered = lines.slice(4).join("\n");
    return filtered || undefined;
  }

  function pushEntry(level: Level, args: string, stack?: string): void {
    if (!recording) return;
    totalSeen++;
    if (buffer.length >= MAX_ENTRIES) return;
    const entry: CapturedEntry = {
      id: genId(),
      level,
      timestamp: Date.now(),
      args,
      pageUrl: location.href,
    };
    if (stack) entry.stack = stack;
    buffer.push(entry);
  }

  // error/warn은 wrap하지 않는다. 페이지가 console.error/warn을 호출하면 native 호출 시점의
  // 콜스택에 우리 wrap 함수가 끼는데, Chrome이 이걸 "이 확장이 console.error를 호출했다"로
  // 잘못 attribution → chrome://extensions 오류 로그에 페이지의 모든 console.error/warn이
  // 누적된다. uncaught 에러는 window.error로, unhandled rejection은 unhandledrejection으로,
  // assertion 실패는 wrapped console.assert에서 직접 error로 push하므로 가치 있는 신호는 보존.
  const LEVELS_TO_WRAP = ["log", "info", "debug"] as const;

  for (const level of LEVELS_TO_WRAP) {
    const original = console[level].bind(console);
    console[level] = function (...args: unknown[]) {
      original(...args);
      pushEntry(level, serializeArgs(args));
    };
  }

  // --- 추가 console.* wrap (trace/assert/dir/table/group*/count*/time*) ---
  // DevTools에서 보이는 신호를 누락 없이 잡는다. 별도 level 신설 대신 기존 5레벨에 매핑해 UI 영향 0.
  const originalTrace = console.trace?.bind(console);
  if (originalTrace) {
    console.trace = function (...args: unknown[]) {
      originalTrace(...args);
      pushEntry("log", `console.trace: ${serializeArgs(args)}`, captureStack());
    };
  }

  const originalAssert = console.assert?.bind(console);
  if (originalAssert) {
    console.assert = function (condition?: unknown, ...args: unknown[]) {
      (originalAssert as (c?: boolean, ...a: unknown[]) => void)(condition as boolean | undefined, ...args);
      if (shouldCaptureAssertion(condition)) {
        const head = args.length > 0 ? `Assertion failed: ${serializeArgs(args)}` : "Assertion failed";
        pushEntry("error", head, captureStack());
      }
    };
  }

  const originalDir = console.dir?.bind(console);
  if (originalDir) {
    console.dir = function (item?: unknown, options?: unknown) {
      originalDir(item, options);
      pushEntry("log", `console.dir: ${safeStringify(item, 0)}`);
    };
  }

  const originalTable = console.table?.bind(console);
  if (originalTable) {
    console.table = function (data?: unknown, columns?: unknown) {
      (originalTable as (d?: unknown, c?: string[]) => void)(data, columns as string[] | undefined);
      pushEntry("log", `console.table: ${safeStringify(data, 0)}`);
    };
  }

  const originalGroup = console.group?.bind(console);
  if (originalGroup) {
    console.group = function (...args: unknown[]) {
      originalGroup(...args);
      pushEntry("log", `▶ ${serializeArgs(args) || "group"}`);
    };
  }
  const originalGroupCollapsed = console.groupCollapsed?.bind(console);
  if (originalGroupCollapsed) {
    console.groupCollapsed = function (...args: unknown[]) {
      originalGroupCollapsed(...args);
      pushEntry("log", `▶ ${serializeArgs(args) || "group"}`);
    };
  }
  const originalGroupEnd = console.groupEnd?.bind(console);
  if (originalGroupEnd) {
    console.groupEnd = function () {
      originalGroupEnd();
      pushEntry("log", "◀ groupEnd");
    };
  }

  const counters = new Map<string, number>();
  const originalCount = console.count?.bind(console);
  if (originalCount) {
    console.count = function (label?: string) {
      originalCount(label);
      const key = label ?? "default";
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      pushEntry("log", `${key}: ${next}`);
    };
  }
  const originalCountReset = console.countReset?.bind(console);
  if (originalCountReset) {
    console.countReset = function (label?: string) {
      originalCountReset(label);
      counters.set(label ?? "default", 0);
    };
  }

  const timers = new Map<string, number>();
  const originalTime = console.time?.bind(console);
  if (originalTime) {
    console.time = function (label?: string) {
      originalTime(label);
      timers.set(label ?? "default", Date.now());
    };
  }
  const originalTimeEnd = console.timeEnd?.bind(console);
  if (originalTimeEnd) {
    console.timeEnd = function (label?: string) {
      originalTimeEnd(label);
      const key = label ?? "default";
      const start = timers.get(key);
      timers.delete(key);
      const elapsed = start != null ? Date.now() - start : NaN;
      pushEntry("log", `${key}: ${isNaN(elapsed) ? "?" : `${elapsed}ms`}`);
    };
  }
  const originalTimeLog = console.timeLog?.bind(console);
  if (originalTimeLog) {
    console.timeLog = function (label?: string, ...args: unknown[]) {
      originalTimeLog(label, ...args);
      const key = label ?? "default";
      const start = timers.get(key);
      const elapsed = start != null ? Date.now() - start : NaN;
      const tail = args.length > 0 ? ` ${serializeArgs(args)}` : "";
      pushEntry("log", `${key}: ${isNaN(elapsed) ? "?" : `${elapsed}ms`}${tail}`);
    };
  }

  // --- Uncaught error / Unhandled rejection ---
  // capture phase — 페이지 핸들러가 stopPropagation해도 우리 listener는 통과.
  window.addEventListener(
    "error",
    (e: ErrorEvent) => {
      const { args, stack } = formatErrorEvent({
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error,
      });
      pushEntry("error", args, stack);
    },
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (e: PromiseRejectionEvent) => {
      const { args, stack } = formatRejectionReason(e.reason);
      pushEntry("error", args, stack);
    },
    true,
  );

  // --- Sentinel-bound dispatch ---
  let currentSentinel: string | null = null;
  let stopHandler: (() => void) | null = null;
  let syncHandler: (() => void) | null = null;
  let clearHandler: (() => void) | null = null;

  function dispatch(): void {
    if (!currentSentinel) return;
    document.dispatchEvent(
      new CustomEvent("__bugshot_console_data__" + currentSentinel, {
        detail: {
          sentinel: currentSentinel,
          entries: buffer.slice(),
          totalSeen,
        },
      }),
    );
  }

  function clearBuffer(): void {
    buffer.length = 0;
    totalSeen = 0;
  }

  function detachSentinelListeners(): void {
    if (!currentSentinel) return;
    if (stopHandler) document.removeEventListener("__bugshot_console_stop__" + currentSentinel, stopHandler);
    if (syncHandler) document.removeEventListener("__bugshot_console_sync__" + currentSentinel, syncHandler);
    if (clearHandler) document.removeEventListener("__bugshot_console_clear__" + currentSentinel, clearHandler);
  }

  function setSentinel(sentinel: string): void {
    detachSentinelListeners();
    currentSentinel = sentinel;
    recording = true;
    stopHandler = () => { recording = false; dispatch(); };
    syncHandler = () => { dispatch(); };
    clearHandler = () => { clearBuffer(); };
    document.addEventListener("__bugshot_console_stop__" + sentinel, stopHandler);
    document.addEventListener("__bugshot_console_sync__" + sentinel, syncHandler);
    document.addEventListener("__bugshot_console_clear__" + sentinel, clearHandler);
  }

  document.addEventListener(SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  (window as any)[CTRL_KEY] = { setSentinel, clearBuffer };
}

consoleRecorderScript();
