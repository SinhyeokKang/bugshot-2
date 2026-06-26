import {
  buildLightSelector,
  truncateName,
  maskValue,
  shouldMaskField,
  entryNavOnBind,
  formatKeyCombo,
} from "./action-recorder-helpers";
import { createTrailingThrottle, FLUSH_INTERVAL_MS } from "./log-throttle";
import { readPreArmFlag, setPreArmFlag } from "./recorder-prearm";

function actionRecorderScript(): void {
  const CTRL_KEY = "__bugshot_action_ctrl__";
  if ((window as any)[CTRL_KEY]) return;

  const MAX_ENTRIES = 1000;
  const VALUE_CAP = 500;
  const SET_SENTINEL_EVENT = "__bugshot_action_setSentinel__";
  // overlay.ts HOST_ID — MAIN world라 import 불가, 리터럴 동기화.
  const HOST_ID = "__bugshot_picker_host";

  type Kind = "click" | "navigation" | "input" | "keypress" | "toggle" | "select";
  type NavType = "load" | "pushState" | "replaceState" | "popstate" | "hashchange";

  interface CapturedAction {
    id: string;
    kind: Kind;
    timestamp: number;
    pageUrl: string;
    target?: string;
    role?: string;
    selector?: string;
    tagName?: string;
    tagType?: string;
    navType?: NavType;
    fromUrl?: string;
    toUrl?: string;
    fieldLabel?: string;
    value?: string;
    masked?: boolean;
    preArm?: boolean;
  }

  const buffer: CapturedAction[] = [];
  let totalSeen = 0;
  let recording = false;
  // pre-arm: active origin이면 sentinel 전에도 적재(capturing). dispatch는 sentinel 없으면 no-op.
  let capturing = readPreArmFlag();
  let lastUrl = location.href;

  function genId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // throttle은 pushAction이 schedule을 호출하므로 첫 pushAction(아래 init recordNavigation)
  // 보다 먼저 선언돼야 한다 — pre-arm으로 init부터 capturing=true면 TDZ ReferenceError 발생.
  // dispatch는 hoisted function 선언이라 여기서 참조 가능.
  const throttle = createTrailingThrottle(dispatch, FLUSH_INTERVAL_MS);

  function pushAction(entry: CapturedAction): void {
    if (!capturing) return;
    if (!recording) entry.preArm = true;
    totalSeen++;
    // 버그 재현 시 가치 있는 신호는 후반부이므로 cap 도달 시 oldest를 버리는 FIFO.
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
    throttle.schedule();
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
    // 빈 접근성 이름은 undefined로 정규화 — resolveClickTarget이 tag 모드로 넘어가도록.
    const name = truncateName(accessibleName(el)) || undefined;
    pushAction({
      id: genId(),
      kind: "click",
      timestamp: Date.now(),
      pageUrl: location.href,
      target: name,
      role: implicitRole(el) ?? undefined,
      selector,
      tagName: el.tagName.toLowerCase(),
      tagType: el.getAttribute("type") ?? undefined,
    });
  }

  function fieldMaskInput(el: Element) {
    const input = el as HTMLInputElement;
    return {
      type: (el as HTMLElement).isContentEditable ? undefined : input.type,
      name: el.getAttribute("name") ?? undefined,
      id: el.id || undefined,
      autocomplete: el.getAttribute("autocomplete") ?? undefined,
      ariaLabel: el.getAttribute("aria-label") ?? undefined,
    };
  }

  function recordInput(el: HTMLElement): void {
    const input = el as HTMLInputElement;
    const isContentEditable = el.isContentEditable;
    const masked = shouldMaskField(fieldMaskInput(el));
    const raw = isContentEditable
      ? (el.textContent || "").trim()
      : input.value ?? "";
    const value = masked ? maskValue(raw) : raw.slice(0, VALUE_CAP);
    const selector = buildLightSelector(el);

    // dedup 분기도 pushAction과 동일한 recording 게이트 적용 — stop 이후 입력이
    // 정지된 세션 버퍼의 마지막 entry를 덮어쓰지 않도록.
    const last = buffer[buffer.length - 1];
    if (capturing && last && last.kind === "input" && last.selector === selector) {
      last.value = value;
      last.masked = masked;
      last.timestamp = Date.now();
      if (!recording) last.preArm = true;
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

  // pre-arm으로 init load(아래 recordNavigation("load"))가 적재되면 true가 되어,
  // setSentinel의 entryNavOnBind 보충을 스킵 → 진입 load 액션 중복 방지.
  let entryNavEmitted = false;

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
    if (navType === "load" && capturing) entryNavEmitted = true;
  }

  function isToggleControl(el: Element | null): el is HTMLInputElement {
    if (!el || el.tagName.toLowerCase() !== "input") return false;
    const t = (el as HTMLInputElement).type;
    return t === "checkbox" || t === "radio";
  }

  // 클릭 타깃(또는 <label for>/래핑 label의 연결 컨트롤)이 checkbox/radio면 change가 toggle로
  // 기록하므로 click을 건너뛴다 — click+toggle 이중 기록 방지.
  function resolvesToToggle(el: Element): boolean {
    if (isToggleControl(el)) return true;
    const label = el.closest?.("label") as HTMLLabelElement | null;
    if (label) {
      const control = label.htmlFor
        ? document.getElementById(label.htmlFor)
        : label.control ?? null;
      if (isToggleControl(control)) return true;
    }
    return false;
  }

  function recordToggle(el: HTMLInputElement): void {
    pushAction({
      id: genId(),
      kind: "toggle",
      timestamp: Date.now(),
      pageUrl: location.href,
      fieldLabel: fieldLabel(el),
      value: el.checked ? "checked" : "unchecked",
      selector: buildLightSelector(el),
    });
  }

  function selectedText(el: HTMLSelectElement): string {
    if (el.multiple) {
      const texts = Array.from(el.selectedOptions).map((o) => o.text);
      return texts.join(", ").slice(0, VALUE_CAP);
    }
    return (el.options[el.selectedIndex]?.text ?? "").slice(0, VALUE_CAP);
  }

  function recordSelect(el: HTMLSelectElement): void {
    pushAction({
      id: genId(),
      kind: "select",
      timestamp: Date.now(),
      pageUrl: location.href,
      fieldLabel: fieldLabel(el),
      value: selectedText(el),
      selector: buildLightSelector(el),
    });
  }

  function recordKeypress(combo: string, focused: Element | null): void {
    pushAction({
      id: genId(),
      kind: "keypress",
      timestamp: Date.now(),
      pageUrl: location.href,
      value: combo,
      target: focused ? truncateName(accessibleName(focused)) : undefined,
      selector: focused ? buildLightSelector(focused) : undefined,
    });
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
      const el = interactive ?? target;
      if (resolvesToToggle(el)) return;
      recordClick(el);
    },
    true,
  );

  // --- Keypress (capture) — 특수키·모디파이어 조합만, IME 조합·인쇄 문자 제외 ---
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      const path = typeof e.composedPath === "function" ? e.composedPath() : undefined;
      if (isOwnUi(target, path)) return;
      const combo = formatKeyCombo({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        isComposing: e.isComposing,
      });
      if (!combo) return;
      const focused = document.activeElement;
      // 민감 필드(password 등) 포커스 중엔 키 조합·필드 식별자 누출 방지 — 캡처 스킵.
      if (focused && shouldMaskField(fieldMaskInput(focused))) return;
      const named =
        focused && focused !== document.body && focused !== document.documentElement
          ? focused
          : null;
      recordKeypress(combo, named);
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
    // select·toggle은 change 1회만 기록(input·change 동시 발화로 인한 중복 방지). 텍스트는 둘 다 통과 후 dedup.
    if (tag === "select") {
      if (e.type === "change") recordSelect(el as HTMLSelectElement);
      return;
    }
    if (isToggleControl(el)) {
      if (e.type === "change") recordToggle(el);
      return;
    }
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
    capturing = true;
    setPreArmFlag(); // 이후 reload/same-origin 네비에서 pre-arm 적재가 켜지도록 active 표시.
    // 진입 네비게이션 보충 — pre-arm으로 load 액션이 안 잡힌 경우를 1회 합성(entryNavEmitted 가드로 중복 방지).
    const entryNav = entryNavOnBind(entryNavEmitted, document.referrer, lastUrl, location.href);
    if (entryNav) {
      entryNavEmitted = true;
      recordNavigation("load", entryNav.fromUrl, entryNav.toUrl);
    }
    if (buffer.length) throttle.schedule(); // pre-arm 초반 버퍼 소급 flush.
    // stop은 현재 world의 적재·전송을 끈다(capturing=false). 플래그는 유지(reload 시 재-pre-arm).
    stopHandler = () => { recording = false; capturing = false; throttle.flushNow(); };
    syncHandler = () => { throttle.flushNow(); };
    clearHandler = () => { clearBuffer(); throttle.cancel(); };
    document.addEventListener("__bugshot_action_stop__" + sentinel, stopHandler);
    document.addEventListener("__bugshot_action_sync__" + sentinel, syncHandler);
    document.addEventListener("__bugshot_action_clear__" + sentinel, clearHandler);
  }

  document.addEventListener(SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  // 풀 네비게이션으로 MAIN world가 파괴되기 직전 버퍼 flush(보조). sentinel 없으면 dispatch no-op.
  window.addEventListener("pagehide", () => throttle.flushNow());
  // 탭 숨김 직전 최신 꼬리까지 flush(안전망 다중화). hidden 외 상태 변화는 무시.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") throttle.flushNow();
  });

  (window as any)[CTRL_KEY] = { setSentinel, clearBuffer };
}

actionRecorderScript();
