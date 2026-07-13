import type {
  PageMetrics,
  PickerMessage,
  PrepareCaptureResponse,
  ViewportRect,
} from "@/types/picker";
import {
  buildTokenLookup,
  captureEditable,
  collectInspectorInfo,
  collectSelection,
  collectTokens,
  readEditableText,
  restoreEditable,
  shouldRestoreEditable,
  writeEditableText,
  type EditableHandle,
  type TokenLookup,
} from "./css-resolve";
import {
  buildSelector,
  buildInitialTree,
  buildChildrenResponse,
  parentOf,
  firstChildOf,
} from "./dom-describe";
import {
  createOverlay,
  destroyOverlay,
  HOST_ID,
  renderOutline,
  renderInspector,
  renderBadge,
  hideLabel,
  hideOutline,
  updateBanner,
  hideBanner,
  setBlockerScrollYield,
  setBlockerVisible,
  renderPreview,
  clearPreview,
  type OverlayHandle,
} from "./overlay";
import {
  startAreaSelect,
  cancelAreaSelect,
  selectFullViewport,
  attachAreaBlockerListener,
  type AreaSelectHandle,
} from "./area-select";
import {
  beginScrollCapture,
  scrollCaptureTo,
  endScrollCapture,
  type ScrollCaptureSession,
} from "./scroll-capture";
import {
  showAnnotation,
  hideAnnotation,
  setAnnotationTool,
} from "./annotation";
import { PICKER_PORT_NAME } from "@/lib/session-keys";
import { postToRuntime } from "./post-to-runtime";
import {
  announceFrameToParent,
  composeTopRect,
  installFrameOffsetResponder,
  isRegisteredChildFrame,
  rectIntersectsViewport,
  requestFrameOffset,
  setFrameToken,
} from "./frame-geometry";
import {
  ensureCrossOriginLoaded,
  ensureLoaded as ensureCssCacheLoaded,
  invalidate as invalidateCssCache,
  isCacheReady as isCssCacheReady,
  startObserver as startCssCacheObserver,
  stopObserver as stopCssCacheObserver,
} from "./css-source-cache";

type Mode = "idle" | "hover" | "selected" | "area-select";

let mode: Mode = "idle";
let selectedEl: Element | null = null;
let lastHover: Element | null = null;
// 전역 캐시 = 현재 selectedEl 원본(applyStyles/applyText가 리셋 기준으로 참조).
let originalStyle: string | null = null;
let editableHandle: EditableHandle | null = null;
let rafHandle: number | null = null;

interface OriginalState {
  className: string | null;
  style: string | null;
  editable: EditableHandle | null;
  text: string | null;
}
// 변경이 가해질 수 있는 모든 element의 원본 추적(누적 프리뷰). element 전환 시 복원하지
// 않고 유지하며, cleanup(handleClear→restoreAll)에서만 일괄 원복. 순회 필요 → WeakMap 불가.
const editedEls = new Map<Element, OriginalState>();

let overlay: OverlayHandle | null = null;
let areaHandle: AreaSelectHandle | null = null;
let tokenLookup: TokenLookup | null = null;
let tokenBuildHandle: number | null = null;

type InspectorInfo = ReturnType<typeof collectInspectorInfo>;
let inspectorCache = new WeakMap<Element, InspectorInfo>();

function scheduleTokenBuild(): void {
  cancelTokenBuild();
  const run = (): void => {
    tokenBuildHandle = null;
    if (mode === "idle") return;
    void (async () => {
      await ensureCssCacheLoaded();
      if ((mode as Mode) === "idle") return;
      tokenLookup = buildTokenLookup();
      inspectorCache = new WeakMap();
      if ((mode as Mode) === "hover" && lastHover) render();
    })();
  };
  if (typeof requestIdleCallback === "function") {
    tokenBuildHandle = requestIdleCallback(run, { timeout: 1000 });
  } else {
    tokenBuildHandle = window.setTimeout(run, 0);
  }
}

function cancelTokenBuild(): void {
  if (tokenBuildHandle == null) return;
  if (typeof cancelIdleCallback === "function") {
    cancelIdleCallback(tokenBuildHandle);
  } else {
    clearTimeout(tokenBuildHandle);
  }
  tokenBuildHandle = null;
}

// 정적(all_frames) 주입 + programmatic 재주입(ensureContentScript)이 모듈을 두 번 평가할
// 수 있다. 리스너 등록을 포함한 init 전체를 멱등 플래그로 감싸 이중 sendResponse("message
// port closed")·이중 handleClear를 방지 — removeOrphanOverlay는 overlay만 커버라 불충분.
// 플래그는 확장 reload 시 ISOLATED world 재생성으로 리셋돼 재주입으로 자가복구된다(BRIDGE_FLAG 선례).
const PICKER_FLAG = "__bugshotPicker__";
if (!(window as unknown as Record<string, unknown>)[PICKER_FLAG]) {
  (window as unknown as Record<string, unknown>)[PICKER_FLAG] = true;
  registerPickerListeners();
}

function registerPickerListeners(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PICKER_PORT_NAME) return;
    port.onDisconnect.addListener(() => {
      handleClear();
    });
  });
  chrome.runtime.onMessage.addListener(handlePickerMessage);
  // 부모 측 offset 응답기 — 자식 iframe 캡처 시 top overlay 숨김(beginCapturePrep)을 겸한다.
  // arm은 사이드패널의 picker.armFrameOffset(chrome 경로)으로만 세팅 — postMessage 위조 차단.
  installFrameOffsetResponder({
    onChildCapturePrep: beginCapturePrep,
    consumeArm: () => {
      if (frameOffsetArmCount <= 0) return false;
      frameOffsetArmCount -= 1;
      return true;
    },
  });
}

function removeOrphanOverlay(): void {
  const orphan = document.getElementById(HOST_ID);
  if (orphan) orphan.remove();
}

// 함수 선언(호이스팅) — 멱등 가드 블록이 모듈 상단에서 참조한다.
function handlePickerMessage(
  msg: PickerMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (res?: unknown) => void,
): boolean | undefined {
  if (!msg || typeof msg !== "object" || !("type" in msg)) return;
  try {
    switch (msg.type) {
      case "picker.start":
        handleStart(msg.frameToken);
        break;
      case "picker.stop":
        handleStop();
        break;
      case "picker.clear":
        handleClear();
        break;
      case "picker.navigate":
        handleNavigate(msg.direction);
        break;
      case "picker.applyClasses":
        handleApplyClasses(msg.classList);
        break;
      case "picker.applyStyles":
        handleApplyStyles(msg.inlineStyle);
        break;
      case "picker.applyText":
        handleApplyText(msg.text);
        break;
      case "picker.resetAllEdits":
        handleResetAllEdits();
        break;
      case "picker.collectTokens":
        void (async () => {
          try {
            await ensureCssCacheLoaded();
            await ensureCrossOriginLoaded();
            sendResponse({ tokens: collectTokens(selectedEl ?? undefined) });
          } catch (err) {
            console.error("[bugshot] collectTokens error", err);
            sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true;
      case "picker.describeInitial":
        sendResponse(buildInitialTree(selectedEl));
        return;
      case "picker.describeChildren":
        sendResponse(buildChildrenResponse(msg.selector));
        return;
      case "picker.previewHover":
        if (overlay) renderPreview(overlay, msg.selector);
        break;
      case "picker.previewClear":
        if (overlay) clearPreview(overlay);
        break;
      case "picker.selectByPath":
        sendResponse(handleSelectByPath(msg.selector));
        return;
      case "picker.applyEditsBySelector":
        sendResponse(handleApplyEditsBySelector(msg));
        return;
      case "picker.prepareCapture":
        if (window !== window.top) {
          void respondWithTopRect(handlePrepareCapture(), sendResponse);
          return true;
        }
        sendResponse(handlePrepareCapture());
        return;
      case "picker.prepareCaptureBySelector":
        handlePrepareCaptureBySelector(
          msg.selector,
          window === window.top
            ? sendResponse
            : (res) => void respondWithTopRect(res, sendResponse),
        );
        return true;
      case "picker.pageUrl":
        sendResponse({ url: location.href });
        return;
      case "picker.armFrameOffset":
        frameOffsetArmCount += 1;
        break;
      case "picker.endCapture":
        handleEndCapture(msg.cleanup === true);
        break;
      case "picker.startAreaSelect":
        handleStartAreaSelect(msg.restoreAfter);
        break;
      case "picker.cancelAreaSelect":
        handleCancelAreaSelect();
        break;
      case "picker.selectFullViewport":
        sendResponse({ ok: handleSelectFullViewport() });
        return;
      case "picker.beginScrollCapture":
        sendResponse(handleBeginScrollCapture());
        return;
      case "picker.scrollCaptureTo":
        // 세션이 없으면(네비게이션·재주입) 무응답 — ack를 주면 사이드패널이 스크롤 안 된
        // 화면을 남은 타일 수만큼 찍어 깨진 이미지를 "성공"으로 넘긴다.
        if (!scrollSession) return;
        void scrollCaptureTo(scrollSession, msg.y, msg.hideFixed).then(sendResponse);
        return true;
      case "picker.endScrollCapture":
        finishScrollCapture();
        break;
      // annotation 오버레이는 top frame 한정(자식 iframe엔 안 그림). 자식 프레임은 무응답으로 흘려 이중 응답 방지.
      case "annotation.show":
        if (window !== window.top) return;
        showAnnotation();
        break;
      case "annotation.setTool":
        if (window !== window.top) return;
        setAnnotationTool(
          msg.tool,
          msg.tool === null ? null : { color: msg.color, strokeWidth: msg.strokeWidth, opacity: msg.opacity },
        );
        break;
      case "annotation.hide":
        if (window !== window.top) return;
        hideAnnotation();
        break;
      // recorder.* 메시지는 recorder-bridge.ts(all_frames)가 처리 — 무응답으로 흘려 이중 응답 방지.
      default:
        return;
    }
    sendResponse({ ok: true });
  } catch (err) {
    console.error("[bugshot] picker message handler error", msg.type, err);
    sendResponse({ ok: false, error: String(err) });
  }
  return undefined;
}

function beginCapturePrep(): { width: number; height: number } {
  captureInflight += 1;
  if (overlay) overlay.hostEl.style.visibility = "hidden";
  return { width: window.innerWidth, height: window.innerHeight };
}

// iframe 프레임 캡처: inner rect(자기 뷰포트 기준)를 top 좌표로 변환해 응답한다.
// offset 요청이 top overlay 숨김(beginCapturePrep)을 겸하고, viewport는 크롭 scale
// 기준이라 top 크기로 교체. 실패(중첩·타임아웃)면 rect null — 캡처 실패 경로 폴백.
async function respondWithTopRect(
  prep: PrepareCaptureResponse,
  sendResponse: (res?: unknown) => void,
): Promise<void> {
  if (!prep.rect) {
    sendResponse(prep);
    return;
  }
  const offset = await requestFrameOffset();
  if (!offset) {
    sendResponse({ rect: null, viewport: prep.viewport });
    return;
  }
  const rect = composeTopRect(prep.rect, offset);
  // iframe 자체가 top 뷰포트 밖으로 스크롤된 상태 — 크롭이 빈 화면 조각(1px clamp)으로
  // 유효 이미지처럼 저장되는 것을 막고 캡처 실패(rect null) 경로로 폴백.
  if (!rectIntersectsViewport(rect, offset.topViewport)) {
    sendResponse({ rect: null, viewport: offset.topViewport });
    return;
  }
  sendResponse({ rect, viewport: offset.topViewport });
}

function viewportRectOf(el: Element): ViewportRect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function handlePrepareCapture(): PrepareCaptureResponse {
  const viewport = beginCapturePrep();
  if (!selectedEl) return { rect: null, viewport };
  return { rect: viewportRectOf(selectedEl), viewport };
}

// selector 기반 캡처 준비에서 scrollIntoView 직전의 스크롤 위치. endCapture에서 복원.
// 캡처 시퀀스가 인터리브되면(재선택 beforeImage 캡처 중 다른 행 초기화 등) 먼저 끝난
// 쪽의 endCapture가 진행 중 캡처의 스크롤을 미리 원복하지 않도록 inflight 수로 가드하고,
// 슬롯 자체는 first-wins(이미 저장돼 있으면 덮어쓰지 않음)로 최초 위치를 보존.
let capturedScroll: { x: number; y: number } | null = null;
let captureInflight = 0;
// 자식 iframe 캡처마다 offset 응답을 1회 허용하는 arm 카운터(top frame 전용).
// boolean이면 iframe 캡처 2건 인터리브 시 arm이 덮여 한쪽이 타임아웃 실패한다.
let frameOffsetArmCount = 0;

function handlePrepareCaptureBySelector(
  selector: string,
  sendResponse: (res: PrepareCaptureResponse) => void,
): void {
  const viewport = beginCapturePrep();
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    el = null;
  }
  if (!el) {
    sendResponse({ rect: null, viewport });
    return;
  }
  const rect = viewportRectOf(el);
  const outside =
    rect.y < 0 ||
    rect.x < 0 ||
    rect.y + rect.height > window.innerHeight ||
    rect.x + rect.width > window.innerWidth;
  if (!outside) {
    sendResponse({ rect, viewport });
    return;
  }
  if (!capturedScroll) capturedScroll = { x: window.scrollX, y: window.scrollY };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const target = el;
  let responded = false;
  const respond = (r: ViewportRect | null) => {
    if (responded) return;
    responded = true;
    sendResponse({
      rect: r,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => respond(viewportRectOf(target)));
  });
  // hidden 탭에서는 rAF가 발화하지 않아 응답이 매달림 — 캡처 실패(rect null) 경로로 폴백.
  setTimeout(() => respond(null), 500);
}

// cleanup=true는 iframe 캡처 종료 시 사이드패널이 frame 0에 보내는 정리 신호.
// arm이 미소비로 남았으면(자식이 offset 요청 전에 rect null로 조기 실패) prep(+1)이
// 없었던 것이므로 arm만 회수하고 inflight는 깎지 않는다 — 진행 중인 다른 캡처의
// overlay·스크롤 조기 복원(인터리브 오염) 방지. arm 소비/미소비 합산이 항상 짝이 맞는다.
// 한계: arm이 캡처에 바인딩되지 않아 인터리브의 좁은 창(다른 캡처의 arm~consume 사이에
// 이쪽 cleanup 도착)에선 남의 arm을 회수할 수 있다 — 합산은 유지되나 그 캡처는 offset
// 타임아웃 실패(rect null)로 격하. 페이지가 유발 불가한 가용성 한정 잔여.
function handleEndCapture(cleanupOnly: boolean): void {
  if (cleanupOnly && frameOffsetArmCount > 0) {
    frameOffsetArmCount -= 1;
    return;
  }
  captureInflight = Math.max(0, captureInflight - 1);
  if (captureInflight > 0) return;
  if (overlay) overlay.hostEl.style.visibility = "";
  if (capturedScroll) {
    window.scrollTo(capturedScroll.x, capturedScroll.y);
    capturedScroll = null;
  }
}

function handleStart(frameToken?: string): void {
  // 사이드패널이 chrome 경로로 broadcast한 token — top은 PRESENT 등록 검증에, 자식은
  // announce에 쓴다(무인증 postMessage 위조 등록 차단).
  setFrameToken(frameToken ?? null);
  // iframe이면 부모 registry에 등록 — 부모 blocker가 이 프레임 위에서 핸드오프한다.
  if (window !== window.top) announceFrameToParent();
  if (!overlay) {
    removeOrphanOverlay();
    overlay = createOverlay();
  }
  // 누적 프리뷰: 이전 element 변경은 유지(복원 안 함). 변경 없는 현재 element만 정리.
  leaveCurrent();
  selectedEl = null;
  lastHover = null;
  tokenLookup = null;
  startCssCacheObserver();
  void ensureCssCacheLoaded();
  scheduleTokenBuild();
  addHoverListeners();
  setMode("hover");
}

function handleStop(): void {
  removeHoverListeners();
  setMode(selectedEl ? "selected" : "idle");
}

function handleClear(): void {
  if (scrollSession) {
    endScrollCapture(scrollSession);
    scrollSession = null;
  }
  if (areaHandle) {
    cancelAreaSelect(areaHandle);
    areaHandle = null;
  }
  removeHoverListeners();
  detachViewportListeners();
  restoreAll();
  selectedEl = null;
  lastHover = null;
  mode = "idle";
  if (rafHandle != null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (overlay) {
    destroyOverlay(overlay);
    overlay = null;
  }
  hideAnnotation();
  cancelTokenBuild();
  tokenLookup = null;
  inspectorCache = new WeakMap();
  if (capturedScroll) window.scrollTo(capturedScroll.x, capturedScroll.y);
  capturedScroll = null;
  captureInflight = 0;
  frameOffsetArmCount = 0;
  // 세션 종료 후 옛 token PRESENT가 계속 등록되지 않게 top 검증 상태도 함께 리셋.
  setFrameToken(null);
  stopCssCacheObserver();
  invalidateCssCache();
}

function handleNavigate(direction: "parent" | "child"): void {
  if (!selectedEl) return;
  const next =
    direction === "parent" ? parentOf(selectedEl) : firstChildOf(selectedEl);
  if (!next) return;
  leaveCurrent();
  selectedEl = next;
  captureOriginal(next);
  render();
  emitSelected(next);
}

function handleApplyClasses(classList: string[]): void {
  if (!selectedEl) return;
  captureOriginal(selectedEl);
  const el = selectedEl as HTMLElement;
  el.className = classList.join(" ");
  inspectorCache.delete(el);
  render();
  scheduleSelectionUpdate();
}

// 값 끝 !important를 분리해 priority 인자로 적용 — 2-arg setProperty는
// "red !important"를 무효값으로 조용히 드롭한다. 접미사 없는 값은 기존 경로 그대로.
function applyInlineStyle(
  el: HTMLElement,
  inlineStyle: Record<string, string>,
): void {
  for (const [prop, value] of Object.entries(inlineStyle)) {
    if (!value) continue;
    const base = value.replace(/\s*!\s*important\s*$/i, "");
    if (base !== value) {
      // 값이 !important뿐이면 base가 빈 문자열 — setProperty(prop,"")는 removeProperty라 skip.
      if (base) el.style.setProperty(prop, base, "important");
    } else {
      el.style.setProperty(prop, value);
    }
  }
}

function handleApplyStyles(inlineStyle: Record<string, string>): void {
  if (!selectedEl) return;
  captureOriginal(selectedEl);
  const el = selectedEl as HTMLElement;
  if (originalStyle === null) {
    el.removeAttribute("style");
  } else {
    el.setAttribute("style", originalStyle);
  }
  applyInlineStyle(el, inlineStyle);
  inspectorCache.delete(el);
  render();
  // 인라인 편집을 되돌린 직후(키 제거) 직전에 예약된 stale 재수집이 baseline을 오염시킬 수
  // 있다(120ms 디바운스 레이스) — 적용 후 재수집을 다시 예약해 최신 DOM으로 자가치유한다.
  scheduleSelectionUpdate();
}

// selector로 찾은 편집 element를 원본으로 원복 후 전달받은 잔여 edits만 재적용(부분 원복).
// 미등록 요소는 현재 상태를 원본으로 등록 후 적용(패널 재오픈 재바인딩 경로 — DOM은 원복돼 있음).
// found = 요소 발견. 적용 결과가 원본과 같으면 레지스트리에서 제거.
function handleApplyEditsBySelector(msg: {
  selector: string;
  classList: string[];
  inlineStyle: Record<string, string>;
  text: string | null;
}): { found: boolean } {
  let el: Element | null = null;
  try {
    el = document.querySelector(msg.selector);
  } catch {
    el = null;
  }
  if (!el) return { found: false };
  const state = registerOriginal(el);

  restoreElState(el, state);
  const h = el as HTMLElement;
  const nextClass = msg.classList.join(" ");
  if ((h.getAttribute("class") ?? "") !== nextClass) {
    h.className = nextClass;
  }
  applyInlineStyle(h, msg.inlineStyle);
  if (
    msg.text !== null &&
    state.editable &&
    state.text !== null &&
    msg.text !== state.text
  ) {
    writeEditableText(state.editable, msg.text);
  }
  if (isElementClean(el, state)) {
    editedEls.delete(el);
  }
  inspectorCache.delete(el);
  render();
  return { found: true };
}

// 복수 element 버퍼 포함 모든 편집 element를 원복(현재 선택은 유지 — picker 종료 안 함).
// 원복으로 DOM이 원본으로 돌아갔으니 selection의 specified/computed 스타일도 다시 읽어
// 패널 입력 필드의 표시값(placeholder·Select)이 편집된 값에 머무르지 않도록 갱신한다.
function handleResetAllEdits(): void {
  restoreAll();
  render();
  scheduleSelectionUpdate();
}

// 레지스트리에 없을 때만 원본 기록(최초 원본 유지).
function registerOriginal(el: Element): OriginalState {
  let state = editedEls.get(el);
  if (!state) {
    const h = el as HTMLElement;
    const editable = captureEditable(el);
    state = {
      className: h.getAttribute("class"),
      style: h.getAttribute("style"),
      editable,
      text: editable ? readEditableText(editable) : null,
    };
    editedEls.set(el, state);
  }
  return state;
}

// 원본 기록 + 전역 캐시를 현재 element 원본으로 채움.
function captureOriginal(el: Element): void {
  const state = registerOriginal(el);
  originalStyle = state.style;
  editableHandle = state.editable;
}

function restoreElState(el: Element, state: OriginalState): void {
  const h = el as HTMLElement;
  if (state.className === null) {
    h.removeAttribute("class");
  } else {
    h.setAttribute("class", state.className);
  }
  if (state.style === null) {
    h.removeAttribute("style");
  } else {
    h.setAttribute("style", state.style);
  }
  if (
    state.editable &&
    state.text !== null &&
    shouldRestoreEditable(state.editable, state.text)
  ) {
    restoreEditable(state.editable, state.text);
  }
}

// 모든 편집 element 일괄 원복 + 레지스트리·캐시 정리(cleanup 종착점 handleClear에서 호출).
function restoreAll(): void {
  for (const [el, state] of editedEls) restoreElState(el, state);
  editedEls.clear();
  originalStyle = null;
  editableHandle = null;
}

function isElementClean(el: Element, state: OriginalState): boolean {
  const h = el as HTMLElement;
  if (h.getAttribute("class") !== state.className) return false;
  if (h.getAttribute("style") !== state.style) return false;
  if (state.editable && state.text !== null) {
    if (readEditableText(state.editable) !== state.text) return false;
  }
  return true;
}

// element 전환 직전: 현재 selectedEl이 변경 없으면 레지스트리에서 제거(빈 항목 정리).
function leaveCurrent(): void {
  if (!selectedEl) return;
  const state = editedEls.get(selectedEl);
  if (state && isElementClean(selectedEl, state)) {
    editedEls.delete(selectedEl);
  }
}

function handleApplyText(text: string): void {
  if (!selectedEl) return;
  captureOriginal(selectedEl);
  if (!editableHandle) return;
  writeEditableText(editableHandle, text);
  render();
}

function setMode(next: Mode): void {
  mode = next;
  if (overlay) {
    updateBanner(overlay);
    setBlockerVisible(overlay, mode === "hover");
  }
  if (mode === "selected") {
    attachViewportListeners();
  } else {
    detachViewportListeners();
  }
  render();
}

function render(): void {
  if (!overlay) return;
  const target =
    mode === "hover" ? lastHover : mode === "selected" ? selectedEl : null;
  if (!target) {
    hideOutline(overlay);
    return;
  }
  renderOutline(overlay, target, { hideBoxModel: mode === "selected" });
  if (mode === "hover") {
    let info = inspectorCache.get(target);
    if (!info) {
      info = collectInspectorInfo(target, tokenLookup ?? undefined);
      inspectorCache.set(target, info);
    }
    renderInspector(overlay, target, info);
  } else if (mode === "selected") {
    renderBadge(overlay, target);
  } else {
    hideLabel(overlay);
  }
}

function addHoverListeners(): void {
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseout", onMouseOut, true);
  window.addEventListener("keydown", onKeyDown, true);
  if (overlay) {
    overlay.blockerEl.addEventListener("click", onClickCommit);
    overlay.blockerEl.addEventListener("contextmenu", suppressEvent);
    overlay.blockerEl.addEventListener("auxclick", suppressEvent);
    overlay.blockerEl.addEventListener("dblclick", suppressEvent);
  }
}

function removeHoverListeners(): void {
  window.removeEventListener("mousemove", onMouseMove, true);
  window.removeEventListener("mouseout", onMouseOut, true);
  window.removeEventListener("keydown", onKeyDown, true);
  if (overlay) {
    overlay.blockerEl.removeEventListener("click", onClickCommit);
    overlay.blockerEl.removeEventListener("contextmenu", suppressEvent);
    overlay.blockerEl.removeEventListener("auxclick", suppressEvent);
    overlay.blockerEl.removeEventListener("dblclick", suppressEvent);
  }
}

function suppressEvent(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

function attachViewportListeners(): void {
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
}

function detachViewportListeners(): void {
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
}

function onViewportChange(): void {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    if (mode === "selected") render();
  });
}

function elementAtPoint(x: number, y: number): Element | null {
  if (!overlay) return document.elementFromPoint(x, y);
  overlay.blockerEl.style.pointerEvents = "none";
  const el = document.elementFromPoint(x, y);
  overlay.blockerEl.style.pointerEvents = "auto";
  return el;
}

function isOwnUi(el: Element | null): boolean {
  if (!el) return true;
  if (!overlay) return false;
  if (el === overlay.hostEl) return true;
  return overlay.hostEl.contains(el);
}

function onMouseMove(e: MouseEvent): void {
  if (mode !== "hover") return;
  const target = elementAtPoint(e.clientX, e.clientY);
  if (isOwnUi(target) || target === lastHover) return;
  lastHover = target;
  // 등록된 자식 iframe 위에서는 blocker를 투과시켜 안쪽 picker가 이벤트를 받게 한다
  // (핸드오프). 미등록(sandbox·중첩)은 auto 유지 → 클릭이 onClickCommit 거부 경로로.
  // elementAtPoint가 매 호출 끝에 auto 복원하므로 토글은 호출 이후 + hover 변경 시만.
  const handoff =
    !!target &&
    target.tagName === "IFRAME" &&
    isRegisteredChildFrame(target);
  if (overlay) {
    overlay.blockerEl.style.pointerEvents = handoff ? "none" : "auto";
    if (handoff) {
      // 안쪽 picker가 hover를 그린다 — 부모 outline은 숨겨 이중 표시 방지.
      hideOutline(overlay);
      return;
    }
  }
  render();
}

// 포인터가 문서 밖(자식 iframe 내부·창 밖)으로 나가면 mousemove가 더 안 와 outline이
// 마지막 hover에 얼어붙는다 — 문서 이탈 시 잔상 정리.
function onMouseOut(e: MouseEvent): void {
  if (mode !== "hover") return;
  if (e.relatedTarget !== null) return;
  lastHover = null;
  if (overlay) hideOutline(overlay);
}

function onClickCommit(e: MouseEvent): void {
  if (mode !== "hover") return;
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const target = elementAtPoint(e.clientX, e.clientY);
  if (isOwnUi(target) || !target) return;
  // 등록 iframe(안쪽 picker 활성)은 핸드오프 대상 — mousemove 전에 클릭이 먼저 온
  // 드문 레이스에서만 여기 도달하므로 삼킨다(다음 mousemove가 blocker를 투과시킴).
  // 미등록 iframe(sandbox·중첩)은 cross-document 경계로 내부 선택 불가 — 기존 거부 유지.
  if (target.tagName === "IFRAME") {
    if (isRegisteredChildFrame(target)) return;
    removeHoverListeners();
    leaveCurrent();
    selectedEl = null;
    lastHover = null;
    setMode("idle");
    postToRuntime({ type: "picker.iframeUnsupported" });
    return;
  }
  leaveCurrent();
  selectedEl = target;
  captureOriginal(target);
  lastHover = null;
  removeHoverListeners();
  setMode("selected");
  emitSelected(target);
}

function onKeyDown(e: KeyboardEvent): void {
  if (mode !== "hover") return;
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  removeHoverListeners();
  leaveCurrent();
  selectedEl = null;
  lastHover = null;
  setMode("idle");
  postToRuntime({ type: "picker.cancelled" });
}

function postSelectionUpdate(el: Element): void {
  const payload = collectSelection(
    el,
    buildSelector,
    parentOf(el) !== null,
    firstChildOf(el) !== null,
  );
  postToRuntime({
    type: "picker.selectionUpdated",
    payload: {
      selector: payload.selector,
      specifiedStyles: payload.specifiedStyles,
      propSources: payload.propSources,
      computedStyles: payload.computedStyles,
    },
  });
}

function emitSelected(el: Element): void {
  const payload = collectSelection(
    el,
    buildSelector,
    parentOf(el) !== null,
    firstChildOf(el) !== null,
  );
  postToRuntime({ type: "picker.selected", payload });
  void (async () => {
    if (!isCssCacheReady()) {
      await ensureCssCacheLoaded();
      if (selectedEl !== el) return;
      postSelectionUpdate(el);
    }
    // cross-origin author 보강은 background fetch라 더 늦게 도착 — 2차 selectionUpdated.
    await ensureCrossOriginLoaded();
    if (selectedEl !== el) return;
    postSelectionUpdate(el);
  })();
}

let selectionUpdateTimer: number | null = null;

function scheduleSelectionUpdate(): void {
  if (selectionUpdateTimer != null) {
    clearTimeout(selectionUpdateTimer);
  }
  selectionUpdateTimer = window.setTimeout(() => {
    selectionUpdateTimer = null;
    if (!selectedEl) return;
    const target = selectedEl;
    void (async () => {
      await ensureCssCacheLoaded();
      if (selectedEl !== target) return;
      postSelectionUpdate(target);
      await ensureCrossOriginLoaded();
      if (selectedEl !== target) return;
      postSelectionUpdate(target);
    })();
  }, 120);
}

function handleSelectByPath(selector: string): { found: boolean } {
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    target = null;
  }
  if (!target) return { found: false };
  // 재바인딩(패널 재오픈)·복귀 경로는 handleClear 이후라 overlay가 없을 수 있다.
  if (!overlay) {
    removeOrphanOverlay();
    overlay = createOverlay();
    startCssCacheObserver();
    void ensureCssCacheLoaded();
  }
  leaveCurrent();
  selectedEl = target;
  captureOriginal(target);
  lastHover = null;
  removeHoverListeners();
  if (overlay) clearPreview(overlay);
  setMode("selected");
  emitSelected(target);
  return { found: true };
}

/* ── Area Select ─────────────────────────────────── */

function restoreSelected(): void {
  if (areaHandle) {
    cancelAreaSelect(areaHandle);
    areaHandle = null;
  }
  setMode("selected");
}

function handleStartAreaSelect(restoreAfter?: boolean): void {
  if (!overlay) {
    removeOrphanOverlay();
    overlay = createOverlay();
  }
  hideOutline(overlay);
  hideBanner(overlay);
  mode = "area-select";
  const shouldRestore = restoreAfter === true && selectedEl !== null;
  areaHandle = startAreaSelect({
    shadow: overlay.shadow,
    onBlockerRequest(action) {
      if (!overlay) return;
      if (action === "show-crosshair") {
        setBlockerVisible(overlay, true, "crosshair");
      } else {
        setBlockerVisible(overlay, false);
      }
    },
    onSelected(rect, viewport) {
      areaHandle = null;
      postToRuntime({ type: "picker.areaSelected", rect, viewport });
      if (shouldRestore) {
        restoreSelected();
      } else {
        mode = "idle";
        handleClear();
      }
    },
    onCancelled() {
      areaHandle = null;
      postToRuntime({ type: "picker.cancelled" });
      if (shouldRestore) {
        restoreSelected();
      } else {
        mode = "idle";
        handleClear();
      }
    },
  });
  attachAreaBlockerListener(areaHandle, overlay.blockerEl);
}

function handleCancelAreaSelect(): void {
  if (areaHandle) {
    cancelAreaSelect(areaHandle);
    areaHandle = null;
  }
  mode = "idle";
  handleClear();
}

// 드래그 완료 경로 재사용 — areaHandle=null·areaSelected 발화·정리는 startAreaSelect가
// 등록한 onSelected 콜백이 담당한다(중복 작성 금지). false면 사이드패널이 idle로 빠진다.
function handleSelectFullViewport(): boolean {
  if (!areaHandle) return false;
  selectFullViewport(areaHandle);
  return true;
}

/* ── Scroll Capture ──────────────────────────────── */

let scrollSession: ScrollCaptureSession | null = null;

function handleBeginScrollCapture(): PageMetrics {
  // 재진입(연타·재마운트)이면 이전 세션을 먼저 원복한다 — 안 그러면 그 세션이 숨긴 fixed 요소가
  // 영영 복원되지 않고 originalScroll도 유실된다.
  if (scrollSession) {
    endScrollCapture(scrollSession);
    scrollSession = null;
  }
  // dim·사각형·라벨은 걷되 blocker는 남긴다 — 투명이라 캡처엔 안 찍히고 클릭(네비게이션·모달)만 막는다.
  if (areaHandle) {
    cancelAreaSelect(areaHandle);
    areaHandle = null;
  }
  if (overlay) {
    // resize 리스너가 배너를 다시 띄우면(updateBanner) 이후 모든 타일에 크기 pill이 박힌다.
    hideBanner(overlay);
    setBlockerVisible(overlay, true);
    setBlockerScrollYield(overlay, false);
  }
  mode = "idle";
  const { session, metrics } = beginScrollCapture();
  scrollSession = session;
  return metrics;
}

// 사이드패널이 죽어(패널 닫힘·탭 전환) endScrollCapture가 못 오면 페이지에 숨긴 고정 요소와
// 엉뚱한 스크롤이 영구 잔류한다 — handleClear(port disconnect 종착점)에서도 자가 복원한다.
function finishScrollCapture(): void {
  if (!scrollSession) return;
  endScrollCapture(scrollSession);
  scrollSession = null;
  handleClear();
}
