import {
  capLabelMap,
  cleanStack,
  createSafeRecorder,
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
import { addEventListener, CustomEventCtor, dispatchEvent, randomUUID, removeEventListener } from "./recorder-globals";
import { createSentinelRegistry } from "./sentinel-registry";
import { maskUrl } from "./network-recorder-helpers";

function consoleRecorderScript(): void {
  const CTRL_KEY = "__bugshot_console_ctrl__";
  if ((window as any)[CTRL_KEY]) return;

  // log-merge.ts CONSOLE_MAX_ENTRIES와 동일 유지 (sidepanel 번들 격리로 값 동기화 —
  // 공용 상수 모듈로 빼면 recorders-entry가 async loader가 돼 pre-arm이 죽는다).
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

  // 페이지가 crypto를 갈아끼워 모든 id를 같게 만들면 사이드패널 log-merge의 id dedup이
  // 로그 전체를 1건으로 접는다 — 스냅샷 경유.
  function genId(): string {
    if (randomUUID) return randomUUID();
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
      pageUrl: maskUrl(location.href),
    };
    if (stack) entry.stack = stack;
    if (!recording) entry.preArm = true;
    // 버그 재현 시 가치 있는 신호는 후반부이므로 cap 도달 시 oldest를 버리는 FIFO.
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
    throttle.schedule();
  }

  // 모든 wrap은 `원본 호출 → safeRecord(기록)` 순서를 지킨다. safeRecord가 capturing 게이트와
  // try/catch를 함께 들고 있어 비녹화 시 직렬화가 돌지 않고, 기록 실패도 페이지로 새지 않는다.
  const safeRecord = createSafeRecorder(() => capturing);

  // error/warn은 arm(setSentinel) 구간에만 wrap해 attribution 오염 창을 한정한다(상시 설치 회피).
  // install이 그 시점의 직전 메서드(페이지 Sentry 등 포함)를 먼저 호출하므로 DevTools 출력·페이지
  // 모니터링을 보존한다. record 경로(wrapper→record→captureStack)의 스택은 cleanStack이
  // 우리 레코더·확장 프레임을 내용 기준으로 걸러 페이지 코드 프레임만 남긴다(깊이 가정 없음).
  const record = (level: "error" | "warn", args: unknown[]) =>
    safeRecord(() => pushEntry(level, serializeArgs(args), captureStack()));
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
      safeRecord(() => pushEntry(level, serializeArgs(args)));
    };
  }

  // --- 추가 console.* wrap (trace/assert/dir/table/group*/count*/time*) ---
  // DevTools에서 보이는 신호를 누락 없이 잡는다. 별도 level 신설 대신 기존 5레벨에 매핑해 UI 영향 0.
  const originalTrace = console.trace?.bind(console);
  if (originalTrace) {
    console.trace = function (...args: unknown[]) {
      originalTrace(...args);
      safeRecord(() => pushEntry("log", `console.trace: ${serializeArgs(args)}`, captureStack()));
    };
  }

  const originalAssert = console.assert?.bind(console);
  if (originalAssert) {
    console.assert = function (condition?: unknown, ...args: unknown[]) {
      (originalAssert as (c?: boolean, ...a: unknown[]) => void)(condition as boolean | undefined, ...args);
      safeRecord(() => {
        if (!shouldCaptureAssertion(condition)) return;
        const head = args.length > 0 ? `Assertion failed: ${serializeArgs(args)}` : "Assertion failed";
        pushEntry("error", head, captureStack());
      });
    };
  }

  const originalDir = console.dir?.bind(console);
  if (originalDir) {
    console.dir = function (item?: unknown, options?: unknown) {
      originalDir(item, options);
      safeRecord(() => pushEntry("log", `console.dir: ${safeStringify(item, 0)}`));
    };
  }

  const originalDirxml = console.dirxml?.bind(console);
  if (originalDirxml) {
    console.dirxml = function (...args: unknown[]) {
      originalDirxml(...args);
      safeRecord(() => pushEntry("log", `console.dirxml: ${serializeArgs(args)}`.trimEnd()));
    };
  }

  const originalTable = console.table?.bind(console);
  if (originalTable) {
    console.table = function (data?: unknown, columns?: unknown) {
      (originalTable as (d?: unknown, c?: string[]) => void)(data, columns as string[] | undefined);
      safeRecord(() => pushEntry("log", `console.table: ${safeStringify(data, 0)}`));
    };
  }

  const originalGroup = console.group?.bind(console);
  if (originalGroup) {
    console.group = function (...args: unknown[]) {
      originalGroup(...args);
      safeRecord(() => pushEntry("log", `▶ ${serializeArgs(args) || "group"}`));
    };
  }
  const originalGroupCollapsed = console.groupCollapsed?.bind(console);
  if (originalGroupCollapsed) {
    console.groupCollapsed = function (...args: unknown[]) {
      originalGroupCollapsed(...args);
      safeRecord(() => pushEntry("log", `▶ ${serializeArgs(args) || "group"}`));
    };
  }
  const originalGroupEnd = console.groupEnd?.bind(console);
  if (originalGroupEnd) {
    console.groupEnd = function () {
      originalGroupEnd();
      safeRecord(() => pushEntry("log", "◀ groupEnd"));
    };
  }

  // 게이트 밖 누적을 유지하는 이유는 capLabelMap 옆(console-recorder-helpers.ts) 참조.
  const MAX_LABELS = 200;

  const counters = new Map<string, number>();
  const originalCount = console.count?.bind(console);
  if (originalCount) {
    console.count = function (label?: string) {
      originalCount(label);
      const key = label ?? "default";
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      capLabelMap(counters, MAX_LABELS);
      safeRecord(() => pushEntry("log", `${key}: ${next}`));
    };
  }
  const originalCountReset = console.countReset?.bind(console);
  if (originalCountReset) {
    console.countReset = function (label?: string) {
      originalCountReset(label);
      counters.set(label ?? "default", 0);
      capLabelMap(counters, MAX_LABELS);
    };
  }

  const timers = new Map<string, number>();
  const originalTime = console.time?.bind(console);
  if (originalTime) {
    console.time = function (label?: string) {
      originalTime(label);
      timers.set(label ?? "default", Date.now());
      capLabelMap(timers, MAX_LABELS);
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
      safeRecord(() => pushEntry("log", `${key}: ${isNaN(elapsed) ? "?" : `${elapsed}ms`}`));
    };
  }
  const originalTimeLog = console.timeLog?.bind(console);
  if (originalTimeLog) {
    console.timeLog = function (label?: string, ...args: unknown[]) {
      originalTimeLog(label, ...args);
      const key = label ?? "default";
      const start = timers.get(key);
      const elapsed = start != null ? Date.now() - start : NaN;
      safeRecord(() => {
        const tail = args.length > 0 ? ` ${serializeArgs(args)}` : "";
        pushEntry("log", `${key}: ${isNaN(elapsed) ? "?" : `${elapsed}ms`}${tail}`);
      });
    };
  }

  const originalTimeStamp = console.timeStamp?.bind(console);
  if (originalTimeStamp) {
    console.timeStamp = function (label?: string) {
      (originalTimeStamp as (l?: string) => void)(label);
      safeRecord(() => pushEntry("log", `console.timeStamp: ${label ?? ""}`.trimEnd()));
    };
  }

  // 페이지가 콘솔을 비운 시점은 디버깅 맥락이라 신호로 남긴다(버퍼는 비우지 않음).
  const originalClear = console.clear?.bind(console);
  if (originalClear) {
    console.clear = function () {
      originalClear();
      safeRecord(() => pushEntry("log", "console.clear()"));
    };
  }

  // --- Uncaught error / Unhandled rejection ---
  // capture phase — 페이지 핸들러가 stopPropagation해도 우리 listener는 통과.
  addEventListener(
    window,
    "error",
    (e: ErrorEvent) => {
      // 에러 리스너 안에서 throw하면 새 error 이벤트가 나 우리 리스너를 다시 태운다 — 반드시 격리.
      safeRecord(() => {
        const { args, stack } = formatErrorEvent({
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          error: e.error,
        });
        pushEntry("error", args, stack);
      });
    },
    true,
  );

  addEventListener(
    window,
    "unhandledrejection",
    (e: PromiseRejectionEvent) => {
      safeRecord(() => {
        const { args, stack } = formatRejectionReason(e.reason);
        pushEntry("error", args, stack);
      });
    },
    true,
  );

  // --- Sentinel-bound dispatch ---
  // 다중 등록 — 무엇을 막고 무엇이 남는지는 sentinel-registry.ts 헤더 참조.
  const sentinels = createSentinelRegistry();
  const sentinelHandlers = new Map<string, { stop: () => void; sync: () => void; clear: () => void }>();

  function dispatch(): void {
    const registered = sentinels.list();
    if (!registered.length) return;
    for (const sentinel of registered) {
      // 배열은 sentinel마다 새로 뜬다(공유하면 먼저 등록된 위조 리스너가 비운다). 격리는
      // 배열까지 — 엔트리 객체는 공유 참조다. sentinel-registry.ts 헤더 참조.
      dispatchEvent(
        document,
        new CustomEventCtor("__bugshot_console_data__" + sentinel, {
          detail: { sentinel, entries: buffer.slice(), totalSeen },
        }),
      );
    }
  }

  // 녹화 중 pushEntry마다 schedule → 최대 FLUSH_INTERVAL_MS마다 전체 버퍼를 실시간 dispatch.
  const throttle = createTrailingThrottle(dispatch, FLUSH_INTERVAL_MS);

  // 페이지가 sessionStorage pre-arm 플래그를 위조하면 error/warn wrap이 상시 설치된 채 남아
  // chrome://extensions에 확장 attribution 경고가 계속 쌓인다. 그 창을 유한하게 끊는다.
  const PREARM_GRACE_MS = 60000;
  let armedOnce = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  if (preArm) {
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // 해제는 clearTimeout에 의존할 수 없다 — 페이지가 그걸 no-op으로 바꾸면 정당하게
      // arm된 세션이 만료 시점에 죽는다. recording이 아니라 armedOnce를 보는 이유: arm 후
      // stop된 상태에서도 이 타이머가 남의 버퍼를 비우면 안 된다(타이머의 조건은 "arm이
      // 한 번도 안 왔다"이지 "지금 녹화 중이 아니다"가 아니다).
      if (armedOnce) return;
      capturing = false;
      restoreConsoleWrap(console, ewState);
      // clearBuffer가 아니라 버퍼만 비운다 — counters·timers를 지우면 만료 뒤 정당한 arm에서
      // console.count가 1부터 다시 세고 timeEnd가 "?"를 찍어, 위 MAX_LABELS 주석이 지키겠다고
      // 한 DevTools 일치가 깨진다. 명시적 clear 핸들러는 세션 리셋이라 현행대로 전부 비운다.
      buffer.length = 0;
      totalSeen = 0;
      throttle.cancel();
    }, PREARM_GRACE_MS);
  }

  function clearBuffer(): void {
    buffer.length = 0;
    totalSeen = 0;
    counters.clear();
    timers.clear();
  }

  function detachSentinel(sentinel: string): void {
    const handlers = sentinelHandlers.get(sentinel);
    if (!handlers) return;
    sentinelHandlers.delete(sentinel);
    removeEventListener(document, "__bugshot_console_stop__" + sentinel, handlers.stop);
    removeEventListener(document, "__bugshot_console_sync__" + sentinel, handlers.sync);
    removeEventListener(document, "__bugshot_console_clear__" + sentinel, handlers.clear);
  }

  function setSentinel(sentinel: string): void {
    if (sentinels.add(sentinel)) {
      for (const gone of sentinels.evicted()) detachSentinel(gone);
      // stop은 현재 world의 적재·전송을 끄고 error/warn wrap을 원복. 플래그는 유지(reload 시 재-pre-arm).
      const handlers = {
        stop: () => {
          recording = false;
          capturing = false;
          restoreConsoleWrap(console, ewState);
          throttle.flushNow();
        },
        sync: () => { throttle.flushNow(); },
        clear: () => { clearBuffer(); throttle.cancel(); },
      };
      sentinelHandlers.set(sentinel, handlers);
      addEventListener(document, "__bugshot_console_stop__" + sentinel, handlers.stop);
      addEventListener(document, "__bugshot_console_sync__" + sentinel, handlers.sync);
      addEventListener(document, "__bugshot_console_clear__" + sentinel, handlers.clear);
    }
    // 재발행(같은 sentinel)에서도 arm 상태는 다시 세운다 — 리스너만 멱등이다.
    armedOnce = true;
    recording = true;
    capturing = true;
    setPreArmFlag(); // 이후 reload/same-origin 네비에서 pre-arm 적재가 켜지도록 active 표시.
    installEwWrap();
    if (graceTimer != null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    if (buffer.length) throttle.schedule(); // pre-arm 초반 버퍼 소급 flush.
  }

  addEventListener(document, SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  // 풀 네비게이션으로 MAIN world가 파괴되기 직전 버퍼 flush(보조). sentinel 없으면 dispatch no-op.
  // pre-arm으로 init에서 error/warn wrap을 깔았는데 sentinel 미도착(stopHandler 없음)인 경우를 위해
  // 여기서도 원복한다(멱등이라 stop과 중복 안전).
  addEventListener(window, "pagehide", () => {
    restoreConsoleWrap(console, ewState);
    throttle.flushNow();
  });
  // 탭 숨김 직전 최신 꼬리까지 flush(안전망 다중화). hidden 외 상태 변화는 무시.
  addEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") throttle.flushNow();
  });

  // 함수가 아니라 마커다 — 걸어두면 페이지가 부를 수 있다. 용도는 위쪽 중복 초기화 가드뿐.
  (window as any)[CTRL_KEY] = true;
}

consoleRecorderScript();
