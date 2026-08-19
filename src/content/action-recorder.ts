import {
  buildLightSelector,
  labelForText,
  truncateName,
  maskValue,
  shouldMaskField,
  isSensitiveValue,
  entryNavOnBind,
  entryNavType,
  popstateNavType,
  formatKeyCombo,
  exceedsDragThreshold,
  matchesOwnHost,
  DRAG_THRESHOLD_PX,
} from "./action-recorder-helpers";
import { createTrailingThrottle, FLUSH_INTERVAL_MS } from "./log-throttle";
import { readPreArmFlag, setPreArmFlag } from "./recorder-prearm";
import { addEventListener, CustomEventCtor, dispatchEvent, navigationRef, performanceRef, randomUUID, removeEventListener } from "./recorder-globals";
import { createSentinelRegistry } from "./sentinel-registry";
import { maskUrl } from "./network-recorder-helpers";

function actionRecorderScript(): void {
  const CTRL_KEY = "__bugshot_action_ctrl__";
  if ((window as any)[CTRL_KEY]) return;

  // log-merge.ts ACTION_MAX_ENTRIES와 동일 유지 (sidepanel 번들 격리로 값 동기화 —
  // 공용 상수 모듈로 빼면 recorders-entry가 async loader가 돼 pre-arm이 죽는다).
  const MAX_ENTRIES = 1000;
  const VALUE_CAP = 500;
  const SET_SENTINEL_EVENT = "__bugshot_action_setSentinel__";
  // overlay.ts HOST_ID / annotation.ts ANNOTATION_HOST_ID — MAIN world라 import 불가, 리터럴 동기화.
  const HOST_ID = "__bugshot_picker_host";
  const ANNOTATION_HOST_ID = "__bugshot_annotation_host";
  const OWN_HOST_IDS = [HOST_ID, ANNOTATION_HOST_ID];

  type Kind = "click" | "navigation" | "input" | "keypress" | "toggle" | "select" | "drag";
  // src/types/action.ts ActionEntry.navType와 동기화 — MAIN world라 import 대신 리터럴 복제.
  type NavType =
    | "load" | "pushState" | "replaceState" | "popstate" | "hashchange"
    | "reload" | "traverse" | "back" | "forward";

  // src/types/action.ts ActionNode와 동기화 — MAIN world라 import 대신 리터럴 복제.
  interface DragNode {
    name?: string;
    role?: string;
    selector?: string;
    tagName?: string;
    tagType?: string;
  }

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
    dragSource?: DragNode;
    dragTarget?: DragNode;
    preArm?: boolean;
  }

  const buffer: CapturedAction[] = [];
  let totalSeen = 0;
  let recording = false;
  // pre-arm: active origin이면 sentinel 전에도 적재(capturing). dispatch는 sentinel 없으면 no-op.
  const preArm = readPreArmFlag();
  let capturing = preArm;
  let lastUrl = location.href;

  // 드래그 상태기계 (포인터 휴리스틱 source-only / 네이티브 DnD source+target).
  interface DragCandidate { el: Element; x: number; y: number; pointerId: number; }
  let dragCandidate: DragCandidate | null = null;
  let dragging = false;
  let suppressNextClick = false;
  let pendingNativeDrag: DragNode | null = null;

  // 페이지가 crypto를 갈아끼워 모든 id를 같게 만들면 사이드패널 log-merge의 id dedup이
  // 로그 전체를 1건으로 접는다 — 스냅샷 경유.
  function genId(): string {
    if (randomUUID) return randomUUID();
    return `ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // throttle은 pushAction이 schedule을 호출하므로 첫 pushAction(아래 init recordNavigation)
  // 보다 먼저 선언돼야 한다 — pre-arm으로 init부터 capturing=true면 TDZ ReferenceError 발생.
  // dispatch는 hoisted function 선언이라 여기서 참조 가능하지만, 그 안에서 읽는 레지스트리는
  // const라 같은 이유로 throttle보다 먼저 초기화돼야 한다.
  // 다중 등록 — 무엇을 막고 무엇이 남는지는 sentinel-registry.ts 헤더 참조.
  const sentinels = createSentinelRegistry();
  const sentinelHandlers = new Map<string, { stop: () => void; sync: () => void; clear: (e: Event) => void }>();
  const throttle = createTrailingThrottle(dispatch, FLUSH_INTERVAL_MS);

  // 페이지가 sessionStorage pre-arm 플래그를 위조하면 적재가 무기한 켜진 채 남는다. 정당한
  // pre-arm은 패널이 열린 origin의 reload이고 재arm은 tabs.onUpdated status==="complete"에
  // 걸려 있다 — 즉 상한은 document_start부터 **페이지 load 완료까지**를 덮어야 정상 로그를 안 자른다.
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
      clearBuffer();
      // 버퍼에서 진입 load 엔트리를 버렸으니 래치도 함께 내린다 — 안 내리면 이후 정당한 arm에서
      // entryNavOnBind가 "이미 실었다"고 판단해 load 액션이 영구 유실된다. clearBuffer 안에
      // 넣으면 명시적 clear 후 재arm에서 load가 중복 합성되므로 만료 경로 한정.
      entryNavEmitted = false;
      throttle.cancel();
    }, PREARM_GRACE_MS);
  }

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
      const ids = path
        .filter((n): n is Element => n instanceof Element)
        .map((n) => n.id);
      if (matchesOwnHost(ids, OWN_HOST_IDS)) return true;
    }
    return OWN_HOST_IDS.some((id) => !!el.closest?.(`#${id}`));
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

  // click·drag·keypress의 target이 모두 여기를 지난다 — 값 경로(recordInput/recordSelect)와
  // 달리 마스킹 게이트가 없어 저작물·PII가 이름으로 새던 구멍을 여기서 막는다.
  function accessibleName(el: Element): string | null {
    const raw = rawAccessibleName(el);
    if (!raw) return null;
    return isSensitiveValue(raw) ? maskValue(raw) : raw;
  }

  function rawAccessibleName(el: Element): string | null {
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
    // contentEditable(메일 본문·문서·메시지)의 textContent는 사용자 저작물이라 이름으로 쓰지 않는다.
    if (!(el as HTMLElement).isContentEditable) {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return text;
    }
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
    const raw = rawFieldLabel(el);
    return isSensitiveValue(raw) ? maskValue(raw) : raw;
  }

  function rawFieldLabel(el: Element): string {
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
      pageUrl: maskUrl(location.href),
      target: name,
      role: implicitRole(el) ?? undefined,
      selector,
      tagName: el.tagName.toLowerCase(),
      tagType: el.getAttribute("type") ?? undefined,
    });
  }

  // recordClick 인라인 로직 재사용하되 closest 인터랙티브 승격은 제외 — 인자 element를
  // 승격 없이 그대로 기술(grip 핸들·비인터랙티브 드롭존 div도 원소 그대로).
  function describeNode(el: Element): DragNode {
    return {
      name: truncateName(accessibleName(el)) || undefined,
      role: implicitRole(el) ?? undefined,
      selector: buildLightSelector(el),
      tagName: el.tagName.toLowerCase(),
      tagType: el.getAttribute("type") ?? undefined,
    };
  }

  function recordDrag(source: DragNode, target?: DragNode): void {
    pushAction({
      id: genId(),
      kind: "drag",
      timestamp: Date.now(),
      pageUrl: maskUrl(location.href),
      dragSource: source,
      ...(target ? { dragTarget: target } : {}),
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
      labelText: labelForText(el),
      placeholder: el.getAttribute("placeholder") ?? undefined,
    };
  }

  function recordInput(el: HTMLElement): void {
    const input = el as HTMLInputElement;
    const isContentEditable = el.isContentEditable;
    const raw = isContentEditable ? "" : input.value ?? "";
    // contentEditable은 사용자 저작물(메일 본문·문서·메시지)이라 값을 싣지 않는다 — 입력 사실만.
    const masked =
      isContentEditable || shouldMaskField(fieldMaskInput(el)) || isSensitiveValue(raw);
    const value = masked ? maskValue(raw) : raw.slice(0, VALUE_CAP);
    const selector = buildLightSelector(el);

    // dedup 분기도 pushAction과 동일한 capturing 게이트 적용 — stop 이후 입력이
    // 정지된 세션 버퍼의 마지막 entry를 덮어쓰지 않도록.
    const last = buffer[buffer.length - 1];
    if (capturing && last && last.kind === "input" && last.selector === selector) {
      last.value = value;
      last.masked = masked;
      last.timestamp = Date.now();
      if (!recording) last.preArm = true;
      // in-place 갱신도 flush를 예약한다 — 안 하면 연속 타이핑 값이 다음 액션·stop·pagehide
      // 전까지 패널에 안 흐른다.
      throttle.schedule();
      return;
    }
    pushAction({
      id: genId(),
      kind: "input",
      timestamp: Date.now(),
      pageUrl: maskUrl(location.href),
      fieldLabel: fieldLabel(el),
      selector,
      value,
      masked,
    });
  }

  // pre-arm으로 init 진입 네비게이션(아래 recordNavigation(entryType, …))이 적재되면 true가 되어,
  // setSentinel의 entryNavOnBind 보충을 스킵 → 진입 액션 중복 방지.
  let entryNavEmitted = false;

  // 진입·보충 두 경로가 같은 값을 써야 한다 — 보충에 "load"를 하드코딩하면 pre-arm이 놓친
  // 새로고침이 일반 이동으로 강등된다.
  // 캐스트의 실질 하중은 `| undefined`다 — noUncheckedIndexedAccess가 없어 빈 배열을 TS가 못 본다.
  const navEntry = performanceRef?.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const entryType = entryNavType(navEntry?.type, performanceRef?.navigation?.type);

  // 하류 mergeLogItems는 id로만 dedup해 중복을 흡수할 장치가 없다 — 이 래치가 유일한 방어다.
  function isEntryNav(navType: NavType): boolean {
    return navType === "load" || navType === "reload" || navType === "traverse";
  }

  // 갱신 지점을 열거하지 않는다 — <a href="#x">는 popstate 없이 히스토리 인덱스를 +1 하므로,
  // 열거하면 HashRouter 앱에서 인덱스가 한 스텝 뒤처져 이후 방향 판정이 통째로 죽는다.
  // 판정 시점마다 읽고 즉시 덮어쓴다.
  let historyIndex = navigationRef?.currentEntry?.index;
  // 본 적 있는 엔트리 id — 프래그먼트 push를 앞으로가기로 오라벨하지 않기 위한 유일한 단서다.
  // 크기는 히스토리 엔트리 수(브라우저가 상한을 둔다)에 묶인다.
  const seenEntryIds = new Set<string>();
  function syncHistoryIndex(): [number | undefined, number | undefined] {
    const prev = historyIndex;
    historyIndex = navigationRef?.currentEntry?.index;
    return [prev, historyIndex];
  }
  function rememberEntryId(): void {
    const id = navigationRef?.currentEntry?.id;
    if (id !== undefined) seenEntryIds.add(id);
  }
  rememberEntryId();

  function recordNavigation(navType: NavType, fromUrl: string, toUrl: string): void {
    syncHistoryIndex();
    rememberEntryId();
    if (!isEntryNav(navType) && fromUrl === toUrl) return;
    // 저장 필드만 마스킹(#access_token·?token= 등 URL 시크릿). lastUrl은 raw 유지 — dedup 비교 정확도 보존.
    const maskedTo = maskUrl(toUrl);
    pushAction({
      id: genId(),
      kind: "navigation",
      timestamp: Date.now(),
      pageUrl: maskedTo,
      navType,
      fromUrl: maskUrl(fromUrl),
      toUrl: maskedTo,
    });
    lastUrl = toUrl;
    if (isEntryNav(navType) && capturing) entryNavEmitted = true;
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
      pageUrl: maskUrl(location.href),
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
    const raw = selectedText(el);
    const masked = shouldMaskField(fieldMaskInput(el)) || isSensitiveValue(raw);
    pushAction({
      id: genId(),
      kind: "select",
      timestamp: Date.now(),
      pageUrl: maskUrl(location.href),
      fieldLabel: fieldLabel(el),
      value: masked ? maskValue(raw) : raw,
      masked,
      selector: buildLightSelector(el),
    });
  }

  function recordKeypress(combo: string, focused: Element | null): void {
    pushAction({
      id: genId(),
      kind: "keypress",
      timestamp: Date.now(),
      pageUrl: maskUrl(location.href),
      value: combo,
      target: focused ? truncateName(accessibleName(focused)) : undefined,
      selector: focused ? buildLightSelector(focused) : undefined,
    });
  }

  // --- Click (capture) ---
  addEventListener(
    document,
    "click",
    (e: MouseEvent) => {
      // 직전 포인터 드래그가 합성한 click 1회를 삼킨다(pointerdown에서 리셋되어 1제스처 한정).
      if (suppressNextClick) { suppressNextClick = false; return; }
      // 게이트는 suppressNextClick 소비 **뒤**에 — 그 플래그는 비녹화 구간에서도 1제스처 한정으로
      // 소진돼야 한다. 아래는 composedPath·closest 질의라 비녹화 시 전부 건너뛴다.
      if (!capturing) return;
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

  // --- Drag: 포인터 휴리스틱 (source-only, 라이브러리 dnd 커버) ---
  addEventListener(
    document,
    "pointerdown",
    (e: PointerEvent) => {
      suppressNextClick = false; // 매 제스처 시작마다 리셋 — 플래그 누수 방지.
      // 비녹화 시 candidate를 안 만들면 고빈도 pointermove가 null 체크로 즉시 return → 무료.
      if (!capturing) return;
      if (!e.isPrimary || e.button !== 0) return;
      const target = e.target as Element | null;
      if (!target) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : undefined;
      if (isOwnUi(target, path)) return;
      dragCandidate = { el: target, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      dragging = false;
    },
    true,
  );
  addEventListener(
    document,
    "pointermove",
    (e: PointerEvent) => {
      if (!dragCandidate || e.pointerId !== dragCandidate.pointerId) return;
      if (!dragging && exceedsDragThreshold(dragCandidate.x, dragCandidate.y, e.clientX, e.clientY, DRAG_THRESHOLD_PX)) {
        dragging = true;
      }
    },
    true,
  );
  addEventListener(
    document,
    "pointerup",
    (e: PointerEvent) => {
      if (!dragCandidate || e.pointerId !== dragCandidate.pointerId) return;
      const candidate = dragCandidate;
      dragCandidate = null;
      if (!dragging) return;
      dragging = false;
      const endEl = document.elementFromPoint(e.clientX, e.clientY);
      const selection = typeof getSelection === "function" ? getSelection() : null;
      // 가드: 요소 간 이동(팬·스크롤·슬라이더 제외) + 텍스트 선택 제외 + 자체 UI 제외.
      // endEl은 가드 판정에만 쓰고 기록하지 않는다(고스트 신뢰 불가) → target 미부착.
      if (
        !endEl ||
        isOwnUi(endEl) ||
        endEl === candidate.el ||
        selection?.isCollapsed === false
      ) return;
      recordDrag(describeNode(candidate.el));
      suppressNextClick = true;
    },
    true,
  );
  addEventListener(
    document,
    "pointercancel",
    (e: PointerEvent) => {
      // 네이티브 드래그 시작 시 브라우저가 pointercancel 발화 → 후보 클리어로 포인터 경로
      // 무효화. 네이티브 경로(dragstart/drop)만 살아남는 중복 방지 핵심 메커니즘.
      if (dragCandidate && e.pointerId === dragCandidate.pointerId) {
        dragCandidate = null;
        dragging = false;
      }
    },
    true,
  );

  // --- Drag: 네이티브 HTML5 DnD (source+target, draggable=true 커버) ---
  addEventListener(
    document,
    "dragstart",
    (e: Event) => {
      if (!capturing) return;
      const target = e.target as Element | null;
      if (!target) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : undefined;
      if (isOwnUi(target, path)) return;
      pendingNativeDrag = describeNode(target);
    },
    true,
  );
  addEventListener(
    document,
    "drop",
    (e: Event) => {
      if (!pendingNativeDrag) return;
      const target = e.target as Element | null;
      const path = typeof e.composedPath === "function" ? e.composedPath() : undefined;
      // drop의 e.target은 브라우저가 실제 드롭존으로 셋팅 → 신뢰 가능한 target.
      if (target && !isOwnUi(target, path)) {
        recordDrag(pendingNativeDrag, describeNode(target));
      }
      pendingNativeDrag = null;
    },
    true,
  );
  addEventListener(
    document,
    "dragend",
    () => { pendingNativeDrag = null; }, // 드롭 없이 끝나면 보류 폐기.
    true,
  );

  // --- Keypress (capture) — 특수키·모디파이어 조합만, IME 조합·인쇄 문자 제외 ---
  addEventListener(
    document,
    "keydown",
    (e: KeyboardEvent) => {
      // 조합 상태·억제 플래그 같은 부수효과가 없는 핸들러라 최상단 게이트가 안전하다.
      if (!capturing) return;
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
    if (!capturing) return;
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
  addEventListener(document, "input", onInput, true);
  addEventListener(document, "change", onInput, true);

  // --- Navigation ---
  recordNavigation(entryType, document.referrer || lastUrl, location.href);

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
  addEventListener(window, "popstate", () => {
    // recordNavigation이 인덱스·id를 덮어쓰기 전에 확정해야 한다.
    const navType = popstateNavType(
      ...syncHistoryIndex(),
      navigationRef?.currentEntry?.id,
      seenEntryIds,
    );
    recordNavigation(navType, lastUrl, location.href);
  });
  addEventListener(window, "hashchange", (e: HashChangeEvent) => {
    recordNavigation("hashchange", e.oldURL, e.newURL);
  });

  // --- Sentinel-bound dispatch --- (레지스트리는 TDZ 때문에 throttle과 함께 위에서 선언)
  function dispatch(): void {
    const registered = sentinels.list();
    if (!registered.length) return;
    for (const sentinel of registered) {
      // 배열은 sentinel마다 새로 뜬다(공유하면 먼저 등록된 위조 리스너가 비운다). 격리는
      // 배열까지 — 엔트리 객체는 공유 참조다. sentinel-registry.ts 헤더 참조.
      dispatchEvent(
        document,
        new CustomEventCtor("__bugshot_action_data__" + sentinel, {
          detail: { sentinel, entries: buffer.slice(), totalSeen },
        }),
      );
    }
  }

  function clearBuffer(): void {
    buffer.length = 0;
    totalSeen = 0;
  }

  function detachSentinel(sentinel: string): void {
    const handlers = sentinelHandlers.get(sentinel);
    if (!handlers) return;
    sentinelHandlers.delete(sentinel);
    removeEventListener(document, "__bugshot_action_stop__" + sentinel, handlers.stop);
    removeEventListener(document, "__bugshot_action_sync__" + sentinel, handlers.sync);
    removeEventListener(document, "__bugshot_action_clear__" + sentinel, handlers.clear);
  }

  function setSentinel(sentinel: string): void {
    if (sentinels.add(sentinel)) {
      for (const gone of sentinels.evicted()) detachSentinel(gone);
      // stop은 현재 world의 적재·전송을 끈다(capturing=false). 플래그는 유지(reload 시 재-pre-arm).
      const handlers = {
        stop: () => { recording = false; capturing = false; throttle.flushNow(); },
        sync: () => { throttle.flushNow(); },
        // 래치는 발신자가 의도를 밝힌 clear에서만 내린다 — 무조건 내리면 재arm이 유령 진입
        // 항목을 만든다(design.md "clear가 의도를 실어 나른다").
        clear: (e: Event) => {
          clearBuffer();
          throttle.cancel();
          const detail = (e as CustomEvent).detail as { resupplyEntryNav?: boolean } | undefined;
          if (detail?.resupplyEntryNav) entryNavEmitted = false;
        },
      };
      sentinelHandlers.set(sentinel, handlers);
      addEventListener(document, "__bugshot_action_stop__" + sentinel, handlers.stop);
      addEventListener(document, "__bugshot_action_sync__" + sentinel, handlers.sync);
      addEventListener(document, "__bugshot_action_clear__" + sentinel, handlers.clear);
    }
    // 재발행(같은 sentinel)에서도 arm 상태는 다시 세운다 — 리스너만 멱등이다.
    armedOnce = true;
    recording = true;
    capturing = true;
    setPreArmFlag(); // 이후 reload/same-origin 네비에서 pre-arm 적재가 켜지도록 active 표시.
    if (graceTimer != null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    // 진입 네비게이션 보충 — pre-arm으로 load 액션이 안 잡힌 경우를 1회 합성(entryNavEmitted 가드로 중복 방지).
    const entryNav = entryNavOnBind(entryNavEmitted, document.referrer, lastUrl, location.href);
    if (entryNav) {
      entryNavEmitted = true;
      recordNavigation(entryType, entryNav.fromUrl, entryNav.toUrl);
    }
    if (buffer.length) throttle.schedule(); // pre-arm 초반 버퍼 소급 flush.
  }

  addEventListener(document, SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  // 풀 네비게이션으로 MAIN world가 파괴되기 직전 버퍼 flush(보조). sentinel 없으면 dispatch no-op.
  addEventListener(window, "pagehide", () => throttle.flushNow());
  // 탭 숨김 직전 최신 꼬리까지 flush(안전망 다중화). hidden 외 상태 변화는 무시.
  addEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") throttle.flushNow();
  });

  // 함수가 아니라 마커다 — 걸어두면 페이지가 부를 수 있다. 용도는 위쪽 중복 초기화 가드뿐.
  (window as any)[CTRL_KEY] = true;
}

actionRecorderScript();
