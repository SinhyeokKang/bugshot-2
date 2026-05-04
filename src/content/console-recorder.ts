export function consoleRecorderScript(sentinel: string): void {
  const CTRL_KEY = "__bugshot_console_ctrl__";
  const existingCtrl = (window as any)[CTRL_KEY] as
    | { rebind(newSentinel: string): void }
    | undefined;
  if (existingCtrl) {
    existingCtrl.rebind(sentinel);
    return;
  }

  const MAX_ENTRIES = 500;
  const ARG_CAP = 10 * 1024; // 10 KB per serialized args

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
    // skip Error, captureStack, wrapper, patched console method
    const filtered = lines.slice(4).join("\n");
    return filtered || undefined;
  }

  const LEVELS: Level[] = ["log", "info", "warn", "error", "debug"];
  const originals: Record<Level, (...args: unknown[]) => void> = {} as any;

  for (const level of LEVELS) {
    originals[level] = console[level].bind(console);

    console[level] = function (...args: unknown[]) {
      originals[level](...args);
      if (!recording) return;

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

  // --- Event listeners ---

  let currentSentinel = sentinel;
  let dataEvent = "__bugshot_console_data__" + currentSentinel;
  let stopEvent = "__bugshot_console_stop__" + currentSentinel;
  let syncEvent = "__bugshot_console_sync__" + currentSentinel;

  function dispatch(): void {
    document.dispatchEvent(
      new CustomEvent(dataEvent, {
        detail: {
          sentinel: currentSentinel,
          entries: buffer.slice(),
          totalSeen,
        },
      }),
    );
  }

  const stopHandler = () => { recording = false; dispatch(); };
  const syncHandler = () => { dispatch(); };

  document.addEventListener(stopEvent, stopHandler);
  document.addEventListener(syncEvent, syncHandler);

  (window as any)[CTRL_KEY] = {
    rebind(newSentinel: string) {
      document.removeEventListener(stopEvent, stopHandler);
      document.removeEventListener(syncEvent, syncHandler);
      currentSentinel = newSentinel;
      dataEvent = "__bugshot_console_data__" + newSentinel;
      stopEvent = "__bugshot_console_stop__" + newSentinel;
      syncEvent = "__bugshot_console_sync__" + newSentinel;
      document.addEventListener(stopEvent, stopHandler);
      document.addEventListener(syncEvent, syncHandler);
      recording = true;
    },
  };
}
