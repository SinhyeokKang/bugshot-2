import type {
  PickerMessage,
  PrepareCaptureResponse,
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
  setBlockerVisible,
  renderPreview,
  clearPreview,
  type OverlayHandle,
} from "./overlay";
import {
  startAreaSelect,
  cancelAreaSelect,
  attachAreaBlockerListener,
  type AreaSelectHandle,
} from "./area-select";
import { PICKER_PORT_NAME } from "@/lib/session-keys";
import { postToRuntime } from "./post-to-runtime";
import {
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PICKER_PORT_NAME) return;
  port.onDisconnect.addListener(() => {
    handleClear();
  });
});

function removeOrphanOverlay(): void {
  const orphan = document.getElementById(HOST_ID);
  if (orphan) orphan.remove();
}

chrome.runtime.onMessage.addListener(
  (msg: PickerMessage, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    try {
      switch (msg.type) {
        case "picker.start":
          handleStart();
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
          handleSelectByPath(msg.selector);
          break;
        case "picker.applyEditsBySelector":
          sendResponse(handleApplyEditsBySelector(msg));
          return;
        case "picker.prepareCapture":
          sendResponse(handlePrepareCapture());
          return;
        case "picker.prepareCaptureBySelector":
          handlePrepareCaptureBySelector(msg.selector, sendResponse);
          return true;
        case "picker.pageUrl":
          sendResponse({ url: location.href });
          return;
        case "picker.endCapture":
          handleEndCapture();
          break;
        case "picker.startAreaSelect":
          handleStartAreaSelect(msg.restoreAfter);
          break;
        case "picker.cancelAreaSelect":
          handleCancelAreaSelect();
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
  },
);

function handlePrepareCapture(): PrepareCaptureResponse {
  captureInflight += 1;
  if (overlay) overlay.hostEl.style.visibility = "hidden";
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  if (!selectedEl) return { rect: null, viewport };
  const r = selectedEl.getBoundingClientRect();
  return {
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    viewport,
  };
}

// selector 기반 캡처 준비에서 scrollIntoView 직전의 스크롤 위치. endCapture에서 복원.
// 캡처 시퀀스가 인터리브되면(재선택 beforeImage 캡처 중 다른 행 초기화 등) 먼저 끝난
// 쪽의 endCapture가 진행 중 캡처의 스크롤을 미리 원복하지 않도록 inflight 수로 가드.
let capturedScroll: { x: number; y: number } | null = null;
let captureInflight = 0;

function handlePrepareCaptureBySelector(
  selector: string,
  sendResponse: (res: PrepareCaptureResponse) => void,
): void {
  captureInflight += 1;
  if (overlay) overlay.hostEl.style.visibility = "hidden";
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
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
  const r = el.getBoundingClientRect();
  const outside =
    r.top < 0 ||
    r.left < 0 ||
    r.bottom > window.innerHeight ||
    r.right > window.innerWidth;
  if (!outside) {
    sendResponse({
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewport,
    });
    return;
  }
  capturedScroll = { x: window.scrollX, y: window.scrollY };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const target = el;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const r2 = target.getBoundingClientRect();
      sendResponse({
        rect: { x: r2.left, y: r2.top, width: r2.width, height: r2.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    });
  });
}

function handleEndCapture(): void {
  captureInflight = Math.max(0, captureInflight - 1);
  if (captureInflight > 0) return;
  if (overlay) overlay.hostEl.style.visibility = "";
  if (capturedScroll) {
    window.scrollTo(capturedScroll.x, capturedScroll.y);
    capturedScroll = null;
  }
}

function handleStart(): void {
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
  cancelTokenBuild();
  tokenLookup = null;
  inspectorCache = new WeakMap();
  capturedScroll = null;
  captureInflight = 0;
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

function handleApplyStyles(inlineStyle: Record<string, string>): void {
  if (!selectedEl) return;
  captureOriginal(selectedEl);
  const el = selectedEl as HTMLElement;
  if (originalStyle === null) {
    el.removeAttribute("style");
  } else {
    el.setAttribute("style", originalStyle);
  }
  for (const [prop, value] of Object.entries(inlineStyle)) {
    if (!value) continue;
    el.style.setProperty(prop, value);
  }
  inspectorCache.delete(el);
  render();
}

// selector로 찾은 편집 element를 원본으로 원복 후 전달받은 잔여 edits만 재적용(부분 원복).
// found = 요소 발견 && editedEls에 편집 존재. 적용 결과가 원본과 같으면 레지스트리에서 제거.
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
  const state = editedEls.get(el);
  if (!state) return { found: false };

  restoreElState(el, state);
  const h = el as HTMLElement;
  const nextClass = msg.classList.join(" ");
  if ((h.getAttribute("class") ?? "") !== nextClass) {
    h.className = nextClass;
  }
  for (const [prop, value] of Object.entries(msg.inlineStyle)) {
    if (!value) continue;
    h.style.setProperty(prop, value);
  }
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

// 레지스트리에 없을 때만 원본 기록(최초 원본 유지) + 전역 캐시를 현재 element 원본으로 채움.
function captureOriginal(el: Element): void {
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
  render();
}

function onClickCommit(e: MouseEvent): void {
  if (mode !== "hover") return;
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const target = elementAtPoint(e.clientX, e.clientY);
  if (isOwnUi(target) || !target) return;
  // iframe 내부 DOM은 cross-document 경계로 elementFromPoint이 도달 못 함 + content
  // script가 all_frames=false라 inner element 선택 자체가 불가능. iframe-as-element
  // 선택을 허용하면 collectTokens / applyStyles 등에서 빈 결과·오류 누적되므로 차단.
  if (target.tagName === "IFRAME") {
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

function emitSelected(el: Element): void {
  const sendInitial = (): void => {
    const payload = collectSelection(
      el,
      buildSelector,
      parentOf(el) !== null,
      firstChildOf(el) !== null,
    );
    postToRuntime({ type: "picker.selected", payload });
  };
  sendInitial();
  if (isCssCacheReady()) return;
  void ensureCssCacheLoaded().then(() => {
    if (selectedEl !== el) return;
    const payload = collectSelection(
      el,
      buildSelector,
      parentOf(el) !== null,
      firstChildOf(el) !== null,
    );
    postToRuntime({
      type: "picker.selectionUpdated",
      payload: {
        specifiedStyles: payload.specifiedStyles,
        propSources: payload.propSources,
        computedStyles: payload.computedStyles,
      },
    });
  });
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
      const payload = collectSelection(
        target,
        buildSelector,
        parentOf(target) !== null,
        firstChildOf(target) !== null,
      );
      postToRuntime({
        type: "picker.selectionUpdated",
        payload: {
          specifiedStyles: payload.specifiedStyles,
          propSources: payload.propSources,
          computedStyles: payload.computedStyles,
        },
      });
    })();
  }, 120);
}

function handleSelectByPath(selector: string): void {
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    target = null;
  }
  if (!target) return;
  leaveCurrent();
  selectedEl = target;
  captureOriginal(target);
  lastHover = null;
  removeHoverListeners();
  if (overlay) clearPreview(overlay);
  setMode("selected");
  emitSelected(target);
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
