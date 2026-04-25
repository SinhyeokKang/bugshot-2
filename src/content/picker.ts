import type {
  PickerMessage,
  PrepareCaptureResponse,
} from "@/types/picker";
import {
  collectSelection,
  collectTokens,
  findEditableTextNode,
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
  renderOutline,
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

type Mode = "idle" | "hover" | "selected" | "area-select";

let mode: Mode = "idle";
let selectedEl: Element | null = null;
let lastHover: Element | null = null;
let originalClassName: string | null = null;
let originalStyle: string | null = null;
let textNode: Text | null = null;
let originalTextContent: string | null = null;
let rafHandle: number | null = null;

let overlay: OverlayHandle | null = null;
let areaHandle: AreaSelectHandle | null = null;
let annotationIframe: HTMLIFrameElement | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "bugshot-picker") return;
  port.onDisconnect.addListener(() => {
    if (mode !== "idle") handleClear();
  });
});

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
        case "picker.resetEdits":
          handleResetEdits();
          break;
        case "picker.collectTokens":
          sendResponse({ tokens: collectTokens(selectedEl ?? undefined) });
          return;
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
        case "picker.prepareCapture":
          sendResponse(handlePrepareCapture());
          return;
        case "picker.endCapture":
          handleEndCapture();
          break;
        case "picker.startAreaSelect":
          handleStartAreaSelect();
          break;
        case "picker.cancelAreaSelect":
          handleCancelAreaSelect();
          break;
        case "picker.showAnnotation":
          showAnnotationIframe();
          break;
        case "picker.hideAnnotation":
          hideAnnotationIframe();
          break;
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

function handleEndCapture(): void {
  if (overlay) overlay.hostEl.style.visibility = "";
}

function handleStart(): void {
  if (!overlay) overlay = createOverlay();
  selectedEl = null;
  lastHover = null;
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
  restoreOriginal();
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
}

function handleNavigate(direction: "parent" | "child"): void {
  if (!selectedEl) return;
  const next =
    direction === "parent" ? parentOf(selectedEl) : firstChildOf(selectedEl);
  if (!next) return;
  restoreOriginal();
  selectedEl = next;
  captureOriginal(next);
  render();
  emitSelected(next);
}

function handleApplyClasses(classList: string[]): void {
  if (!selectedEl) return;
  const el = selectedEl as HTMLElement;
  el.className = classList.join(" ");
  render();
}

function handleApplyStyles(inlineStyle: Record<string, string>): void {
  if (!selectedEl) return;
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
  render();
}

function handleResetEdits(): void {
  if (!selectedEl) return;
  restoreOriginal();
  render();
}

function captureOriginal(el: Element): void {
  const h = el as HTMLElement;
  originalClassName = h.getAttribute("class");
  originalStyle = h.getAttribute("style");
  textNode = findEditableTextNode(el);
  originalTextContent = textNode ? (textNode.textContent ?? "") : null;
}

function restoreOriginal(): void {
  if (!selectedEl) return;
  const el = selectedEl as HTMLElement;
  if (originalClassName === null) {
    el.removeAttribute("class");
  } else {
    el.setAttribute("class", originalClassName);
  }
  if (originalStyle === null) {
    el.removeAttribute("style");
  } else {
    el.setAttribute("style", originalStyle);
  }
  if (textNode && originalTextContent !== null) {
    textNode.textContent = originalTextContent;
  }
}

function handleApplyText(text: string): void {
  if (!textNode) return;
  textNode.textContent = text;
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
  renderOutline(overlay, target);
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
  restoreOriginal();
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
  restoreOriginal();
  selectedEl = null;
  lastHover = null;
  setMode("idle");
  chrome.runtime
    .sendMessage<PickerMessage>({ type: "picker.cancelled" })
    .catch(() => {});
}

function emitSelected(el: Element): void {
  const payload = collectSelection(
    el,
    buildSelector,
    parentOf(el) !== null,
    firstChildOf(el) !== null,
  );
  chrome.runtime
    .sendMessage<PickerMessage>({ type: "picker.selected", payload })
    .catch(() => {});
}

function handleSelectByPath(selector: string): void {
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    target = null;
  }
  if (!target) return;
  restoreOriginal();
  selectedEl = target;
  captureOriginal(target);
  lastHover = null;
  removeHoverListeners();
  if (overlay) clearPreview(overlay);
  setMode("selected");
  emitSelected(target);
}

/* ── Annotation Iframe ───────────────────────────── */

function showAnnotationIframe(): void {
  if (annotationIframe) return;
  annotationIframe = document.createElement("iframe");
  annotationIframe.src = chrome.runtime.getURL("src/annotation/index.html");
  Object.assign(annotationIframe.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    border: "none",
    zIndex: "2147483647",
  });
  annotationIframe.allow = "";
  document.documentElement.appendChild(annotationIframe);
}

function hideAnnotationIframe(): void {
  if (annotationIframe) {
    annotationIframe.remove();
    annotationIframe = null;
  }
}

/* ── Area Select ─────────────────────────────────── */

function handleStartAreaSelect(): void {
  if (!overlay) overlay = createOverlay();
  hideOutline(overlay);
  hideBanner(overlay);
  mode = "area-select";
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
      chrome.runtime
        .sendMessage<PickerMessage>({ type: "picker.areaSelected", rect, viewport })
        .catch(() => {});
      mode = "idle";
      handleClear();
    },
    onCancelled() {
      areaHandle = null;
      chrome.runtime
        .sendMessage<PickerMessage>({ type: "picker.cancelled" })
        .catch(() => {});
      mode = "idle";
      handleClear();
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
