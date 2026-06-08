import {
  buildLightSelector,
  truncateName,
  maskValue,
  shouldMaskField,
  entryNavOnBind,
} from "./action-recorder-helpers";

function actionRecorderScript(): void {
  const CTRL_KEY = "__bugshot_action_ctrl__";
  if ((window as any)[CTRL_KEY]) return;

  const MAX_ENTRIES = 1000;
  const VALUE_CAP = 500;
  const SET_SENTINEL_EVENT = "__bugshot_action_setSentinel__";
  // overlay.ts HOST_ID — MAIN world라 import 불가, 리터럴 동기화.
  const HOST_ID = "__bugshot_picker_host";

  type Kind = "click" | "navigation" | "input";
  type NavType = "load" | "pushState" | "replaceState" | "popstate" | "hashchange";

  interface CapturedAction {
    id: string;
    kind: Kind;
    timestamp: number;
    pageUrl: string;
    target?: string;
    role?: string;
    selector?: string;
    navType?: NavType;
    fromUrl?: string;
    toUrl?: string;
    fieldLabel?: string;
    value?: string;
    masked?: boolean;
  }

  const buffer: CapturedAction[] = [];
  let totalSeen = 0;
  let recording = false;
  let lastUrl = location.href;

  function genId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function pushAction(entry: CapturedAction): void {
    if (!recording) return;
    totalSeen++;
    // 버그 재현 시 가치 있는 신호는 후반부이므로 cap 도달 시 oldest를 버리는 FIFO.
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
  }

  function isOwnUi(el: Element | null, path?: EventTarget[]): boolean {
    if (!el) return false;
    if (path) {
      for (const n of path) {
        if (n instanceof Element && n.id === HOST_ID) return true;
      }
    }
    return !!el.closest?.(`#${HOST_ID}`);
  }

  const ROLE_BY_TAG: Record<string, string> = {
    a: "link",
    button: "button",
  };

  function implicitRole(el: Element): string | null {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const t = (el as HTMLInputElement).type;
      if (t === "submit" || t === "button" || t === "reset") return "button";
    }
    return ROLE_BY_TAG[tag] ?? null;
  }

  function accessibleName(el: Element): string | null {
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text;
    const title = el.getAttribute("title");
    if (title?.trim()) return title.trim();
    const alt = el.getAttribute("alt");
    if (alt?.trim()) return alt.trim();
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const input = el as HTMLInputElement;
      if (input.value && (input.type === "submit" || input.type === "button")) {
        return input.value.trim();
      }
    }
    return null;
  }

  function fieldLabel(el: Element): string {
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = label?.textContent?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder?.trim()) return placeholder.trim();
    const name = el.getAttribute("name");
    if (name?.trim()) return name.trim();
    return buildLightSelector(el);
  }

  function recordClick(el: Element): void {
    const selector = buildLightSelector(el);
    pushAction({
      id: genId(),
      kind: "click",
      timestamp: Date.now(),
      pageUrl: location.href,
      target: truncateName(accessibleName(el)),
      role: implicitRole(el) ?? undefined,
      selector,
    });
  }

  function recordInput(el: HTMLElement): void {
    const input = el as HTMLInputElement;
    const isContentEditable = el.isContentEditable;
    const masked = shouldMaskField({
      type: isContentEditable ? undefined : input.type,
      name: el.getAttribute("name") ?? undefined,
      id: el.id || undefined,
      autocomplete: el.getAttribute("autocomplete") ?? undefined,
      ariaLabel: el.getAttribute("aria-label") ?? undefined,
    });
    const raw = isContentEditable
      ? (el.textContent || "").trim()
      : input.value ?? "";
    const value = masked ? maskValue(raw) : raw.slice(0, VALUE_CAP);
    const selector = buildLightSelector(el);

    const last = buffer[buffer.length - 1];
    if (last && last.kind === "input" && last.selector === selector) {
      last.value = value;
      last.masked = masked;
      last.timestamp = Date.now();
      return;
    }
    pushAction({
      id: genId(),
      kind: "input",
      timestamp: Date.now(),
      pageUrl: location.href,
      fieldLabel: fieldLabel(el),
      selector,
      value,
      masked,
    });
  }

  function recordNavigation(navType: NavType, fromUrl: string, toUrl: string): void {
    if (navType !== "load" && fromUrl === toUrl) return;
    pushAction({
      id: genId(),
      kind: "navigation",
      timestamp: Date.now(),
      pageUrl: toUrl,
      navType,
      fromUrl,
      toUrl,
    });
    lastUrl = toUrl;
  }

  // --- Click (capture) ---
  document.addEventListener(
    "click",
    (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : undefined;
      if (isOwnUi(target, path)) return;
      const interactive = target.closest?.(
        "button, a, [role=button], input[type=submit]",
      );
      recordClick(interactive ?? target);
    },
    true,
  );

  // --- Text input (capture) ---
  function onInput(e: Event): void {
    const target = e.target as Element | null;
    if (!target) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : undefined;
    if (isOwnUi(target, path)) return;
    const el = target as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && !el.isContentEditable) return;
    recordInput(el);
  }
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);

  // --- Navigation ---
  recordNavigation("load", document.referrer || lastUrl, location.href);

  // 페이지가 직접 호출하는 함수이므로 recordNavigation throw가 페이지 라우팅 호출자로
  // 전파되지 않도록 격리한다 (원본은 이미 호출됐으니 네비게이션 동작은 보존).
  const originalPushState = history.pushState.bind(history);
  history.pushState = function (...args: Parameters<History["pushState"]>) {
    const from = location.href;
    const ret = originalPushState(...args);
    try { recordNavigation("pushState", from, location.href); } catch { /* 레코더 오류 무시 */ }
    return ret;
  };
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args: Parameters<History["replaceState"]>) {
    const from = location.href;
    const ret = originalReplaceState(...args);
    try { recordNavigation("replaceState", from, location.href); } catch { /* 레코더 오류 무시 */ }
    return ret;
  };
  window.addEventListener("popstate", () => {
    recordNavigation("popstate", lastUrl, location.href);
  });
  window.addEventListener("hashchange", (e: HashChangeEvent) => {
    recordNavigation("hashchange", e.oldURL, e.newURL);
  });

  // --- Sentinel-bound dispatch ---
  let currentSentinel: string | null = null;
  let entryNavEmitted = false;
  let stopHandler: (() => void) | null = null;
  let syncHandler: (() => void) | null = null;
  let clearHandler: (() => void) | null = null;

  function dispatch(): void {
    if (!currentSentinel) return;
    document.dispatchEvent(
      new CustomEvent("__bugshot_action_data__" + currentSentinel, {
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
    if (stopHandler) document.removeEventListener("__bugshot_action_stop__" + currentSentinel, stopHandler);
    if (syncHandler) document.removeEventListener("__bugshot_action_sync__" + currentSentinel, syncHandler);
    if (clearHandler) document.removeEventListener("__bugshot_action_clear__" + currentSentinel, clearHandler);
  }

  function setSentinel(sentinel: string): void {
    detachSentinelListeners();
    currentSentinel = sentinel;
    recording = true;
    // document_start의 load 기록은 recording=false라 버려진다. cross-origin 진입 자취가
    // 매번 사라지므로, bind 직후 현재 페이지 진입 네비게이션을 1회 보충한다(중복 방지 가드).
    const entryNav = entryNavOnBind(entryNavEmitted, document.referrer, lastUrl, location.href);
    if (entryNav) {
      entryNavEmitted = true;
      recordNavigation("load", entryNav.fromUrl, entryNav.toUrl);
    }
    stopHandler = () => { recording = false; dispatch(); };
    syncHandler = () => { dispatch(); };
    clearHandler = () => { clearBuffer(); };
    document.addEventListener("__bugshot_action_stop__" + sentinel, stopHandler);
    document.addEventListener("__bugshot_action_sync__" + sentinel, syncHandler);
    document.addEventListener("__bugshot_action_clear__" + sentinel, clearHandler);
  }

  document.addEventListener(SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  // 풀 네비게이션으로 MAIN world가 파괴되기 직전 버퍼 flush(보조). sentinel 없으면 dispatch no-op.
  window.addEventListener("pagehide", () => dispatch());

  (window as any)[CTRL_KEY] = { setSentinel, clearBuffer };
}

actionRecorderScript();
