import {
  cleanStack,
  formatErrorEvent,
  formatRejectionReason,
  installConsoleWrap,
  makeConsoleWrapper,
  restoreConsoleWrap,
  safeStringify,
  serializeArgs,
  shouldCaptureAssertion,
} from "./console-recorder-helpers";
import type { EwState } from "./console-recorder-helpers";
import { createTrailingThrottle, FLUSH_INTERVAL_MS } from "./log-throttle";
import { readPreArmFlag, setPreArmFlag } from "./recorder-prearm";

function consoleRecorderScript(): void {
  const CTRL_KEY = "__bugshot_console_ctrl__";
  if ((window as any)[CTRL_KEY]) return;

  const MAX_ENTRIES = 2000;
  const SET_SENTINEL_EVENT = "__bugshot_console_setSentinel__";

  type Level = "log" | "info" | "warn" | "error" | "debug";

  interface CapturedEntry {
    id: string;
    level: Level;
    timestamp: number;
    args: string;
    stack?: string;
    pageUrl: string;
    preArm?: boolean;
  }

  const buffer: CapturedEntry[] = [];
  let totalSeen = 0;
  let recording = false;
  // pre-arm: active origin이면 sentinel 전에도 적재(capturing). dispatch는 sentinel 없으면 no-op.
  const preArm = readPreArmFlag();
  let capturing = preArm;

  function genId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `cl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function captureStack(): string | undefined {
    return cleanStack(new Error().stack);
  }

  function pushEntry(level: Level, args: string, stack?: string): void {
    if (!capturing) return;
    totalSeen++;
    const entry: CapturedEntry = {
      id: genId(),
      level,
      timestamp: Date.now(),
      args,
      pageUrl: location.href,
    };
    if (stack) entry.stack = stack;
    if (!recording) entry.preArm = true;
    // 버그 재현 시 가치 있는 신호는 후반부이므로 cap 도달 시 oldest를 버리는 FIFO.
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
    throttle.schedule();
  }

  // error/warn은 arm(setSentinel) 구간에만 wrap해 attribution 오염 창을 한정한다(상시 설치 회피).
  // install이 그 시점의 직전 메서드(페이지 Sentry 등 포함)를 먼저 호출하므로 DevTools 출력·페이지
  // 모니터링을 보존한다. record 경로(wrapper→record→captureStack)의 스택은 cleanStack이
  // 우리 레코더·확장 프레임을 내용 기준으로 걸러 페이지 코드 프레임만 남긴다(깊이 가정 없음).
  const record = (level: "error" | "warn", args: unknown[]) =>
    pushEntry(level, serializeArgs(args), captureStack());
  const ewState: EwState = { installed: false, prior: null, ours: null };

  function installEwWrap(): void {
    installConsoleWrap(console, ewState, (native, level) =>
      makeConsoleWrapper(native, level, record),
    );
  }

  // pre-arm: active origin이면 document_start부터 error/warn도 후킹해 로드 초반 에러/경고를 잡는다.
  // 멱등(ewState.installed)이라 이후 setSentinel의 재호출은 no-op.
  if (preArm) installEwWrap();

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

  const originalDirxml = console.dirxml?.bind(console);
  if (originalDirxml) {
    console.dirxml = function (...args: unknown[]) {
      originalDirxml(...args);
      pushEntry("log", `console.dirxml: ${serializeArgs(args)}`);
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

  const originalTimeStamp = console.timeStamp?.bind(console);
  if (originalTimeStamp) {
    console.timeStamp = function (label?: string) {
      (originalTimeStamp as (l?: string) => void)(label);
      pushEntry("log", `console.timeStamp: ${label ?? ""}`.trimEnd());
    };
  }

  // 페이지가 콘솔을 비운 시점은 디버깅 맥락이라 신호로 남긴다(버퍼는 비우지 않음).
  const originalClear = console.clear?.bind(console);
  if (originalClear) {
    console.clear = function () {
      originalClear();
      pushEntry("log", "console.clear()");
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

  // 녹화 중 pushEntry마다 schedule → 최대 FLUSH_INTERVAL_MS마다 전체 버퍼를 실시간 dispatch.
  const throttle = createTrailingThrottle(dispatch, FLUSH_INTERVAL_MS);

  function clearBuffer(): void {
    buffer.length = 0;
    totalSeen = 0;
    counters.clear();
    timers.clear();
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
    capturing = true;
    setPreArmFlag(); // 이후 reload/same-origin 네비에서 pre-arm 적재가 켜지도록 active 표시.
    installEwWrap();
    if (buffer.length) throttle.schedule(); // pre-arm 초반 버퍼 소급 flush.
    // stop은 현재 world의 적재·전송을 끄고 error/warn wrap을 원복. 플래그는 유지(reload 시 재-pre-arm).
    stopHandler = () => {
      recording = false;
      capturing = false;
      restoreConsoleWrap(console, ewState);
      throttle.flushNow();
    };
    syncHandler = () => { throttle.flushNow(); };
    clearHandler = () => { clearBuffer(); throttle.cancel(); };
    document.addEventListener("__bugshot_console_stop__" + sentinel, stopHandler);
    document.addEventListener("__bugshot_console_sync__" + sentinel, syncHandler);
    document.addEventListener("__bugshot_console_clear__" + sentinel, clearHandler);
  }

  document.addEventListener(SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  // 풀 네비게이션으로 MAIN world가 파괴되기 직전 버퍼 flush(보조). sentinel 없으면 dispatch no-op.
  // pre-arm으로 init에서 error/warn wrap을 깔았는데 sentinel 미도착(stopHandler 없음)인 경우를 위해
  // 여기서도 원복한다(멱등이라 stop과 중복 안전).
  window.addEventListener("pagehide", () => {
    restoreConsoleWrap(console, ewState);
    throttle.flushNow();
  });
  // 탭 숨김 직전 최신 꼬리까지 flush(안전망 다중화). hidden 외 상태 변화는 무시.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") throttle.flushNow();
  });

  (window as any)[CTRL_KEY] = { setSentinel, clearBuffer };
}

consoleRecorderScript();
