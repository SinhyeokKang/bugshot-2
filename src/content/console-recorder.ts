// MAIN world 콘솔 레코더. content_scripts(document_start, world: MAIN)로 모든 페이지에 자동 주입되어
// console.* 호출을 즉시 wrap한다. 사이드패널이 setSentinel을 보내기 전까지는 wrap만 통과시키고 buffering은 하지 않는다.
export function consoleRecorderScript(): void {
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
  let bufferingEnabled = false;
  let recording = true;

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

  const LEVELS: Level[] = ["log", "info", "warn", "error", "debug"];
  const originals: Record<Level, (...args: unknown[]) => void> = {} as any;

  for (const level of LEVELS) {
    originals[level] = console[level].bind(console);

    console[level] = function (...args: unknown[]) {
      originals[level](...args);
      if (!recording || !bufferingEnabled) return;

      totalSeen++;
      if (buffer.length >= MAX_ENTRIES) return;

      const entry: CapturedEntry = {
        id: genId(),
        level,
        timestamp: Date.now(),
        args: serializeArgs(args),
        pageUrl: location.href,
      };

      if (level === "error" || level === "warn") {
        entry.stack = captureStack();
      }

      buffer.push(entry);
    };
  }

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
    bufferingEnabled = true;
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
