import type {
  PageMetrics,
  PickerMessage,
  PrepareCaptureResponse,
  ViewportRect,
} from "@/types/picker";
import {
  captureEditable,
  collectInspectorInfo,
  collectSelection,
  collectTokens,
  readEditableText,
  restoreEditable,
  shouldRestoreEditable,
  writeEditableText,
  type EditableHandle,
} from "./css-resolve";
import {
  applyStyleOverlay,
  createStyleOverlayState,
  disconnectStyleOverlay,
  restoreStyleOverlay,
  type StyleOverlayState,
} from "./style-overlay";
import {
  findContextAncestor,
  passesContextGates,
  resolveContextRect,
} from "./capture-context";
import {
  buildSelector,
  buildInitialTree,
  buildChildrenResponse,
  parentOf,
  firstChildOf,
} from "./dom-describe";
import { buildStableSelector, reuseStableSelector } from "./element-locator";
import {
  createOverlay,
  setOverlayTheme,
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
  setBlockerHandoff,
  setBlockerVisible,
  cancelBlockerScrollYield,
  setHoverShield,
  withBlockerHitTest,
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
import { afterPaint } from "./after-paint";
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
  setOnCacheReloaded,
} from "./css-source-cache";

type Mode = "idle" | "hover" | "selected" | "area-select";

let mode: Mode = "idle";
let activePickerSessionId: string | null = null;
let selectedEl: Element | null = null;
let selectionDetachedNotified = false;
let lastHover: Element | null = null;
// 전역 캐시 = 현재 selectedEl 원본(applyStyles/applyText가 리셋 기준으로 참조).
let editableHandle: EditableHandle | null = null;
let rafHandle: number | null = null;

interface OriginalState {
  className: string | null;
  classAdded: Set<string>;
  classRemoved: Set<string>;
  style: string | null;
  styleOverlay: StyleOverlayState;
  editable: EditableHandle | null;
  text: string | null;
  lastAppliedText: string | null;
  ownershipObserver: MutationObserver;
  externalClassMutations: Set<string>;
  externalTextMutation: boolean;
}
// 변경이 가해질 수 있는 모든 element의 원본 추적(누적 프리뷰). element 전환 시 복원하지
// 않고 유지하며, cleanup(handleClear→restoreAll)에서만 일괄 원복. 순회 필요 → WeakMap 불가.
const editedEls = new Map<Element, OriginalState>();

let overlay: OverlayHandle | null = null;
let areaHandle: AreaSelectHandle | null = null;
// 현재 area-select 세션이 끝난 뒤 선택 상태로 돌아가야 하는지(element 편집 중 본문 이미지 삽입).
let areaRestoreAfter = false;
let inspectorRefreshHandle: number | null = null;

type InspectorInfo = ReturnType<typeof collectInspectorInfo>;
let inspectorCache = new WeakMap<Element, InspectorInfo>();

function scheduleInspectorRefresh(): void {
  cancelInspectorRefresh();
  const run = (): void => {
    inspectorRefreshHandle = null;
    if (mode === "idle") return;
    void (async () => {
      await ensureCssCacheLoaded();
      if ((mode as Mode) === "idle") return;
      inspectorCache = new WeakMap();
      if ((mode as Mode) === "hover" && lastHover) render();
      await ensureCrossOriginLoaded();
      if ((mode as Mode) === "idle") return;
      inspectorCache = new WeakMap();
      if ((mode as Mode) === "hover" && lastHover) render();
    })().catch(() => {
      // 보강 실패는 인스펙터 값이 덜 풍부해질 뿐 캡처를 막지 않는다 — 삼킨다.
    });
  };
  if (typeof requestIdleCallback === "function") {
    inspectorRefreshHandle = requestIdleCallback(run, { timeout: 1000 });
  } else {
    inspectorRefreshHandle = window.setTimeout(run, 0);
  }
}

function cancelInspectorRefresh(): void {
  if (inspectorRefreshHandle == null) return;
  if (typeof cancelIdleCallback === "function") {
    cancelIdleCallback(inspectorRefreshHandle);
  } else {
    clearTimeout(inspectorRefreshHandle);
  }
  inspectorRefreshHandle = null;
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
        handleStart(msg.frameToken, msg.theme);
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
        if (msg.sessionId) activePickerSessionId = msg.sessionId;
        sendResponse(handleSelectByPath(msg.selector));
        return;
      case "picker.applyEditsBySelector":
        sendResponse(handleApplyEditsBySelector(msg));
        return;
      // 측정은 동기로 먼저(오버레이 숨김은 레이아웃을 바꾸지 않는다), 응답만 숨김 프레임이
      // 커밋된 뒤로 미룬다 — 즉답하면 캡처가 오버레이가 남은 프레임을 찍는다. iframe은
      // top 오버레이 숨김이 offset 왕복 안에서 일어나므로 respondWithTopRect가 대기를 맡는다.
      case "picker.prepareCapture": {
        const prep = handlePrepareCapture(msg);
        if (window !== window.top) {
          void respondWithTopRect(prep, sendResponse);
          return true;
        }
        respondAfterPaint(prep, sendResponse);
        return true;
      }
      // 이 경로는 분기마다 대기 지점이 달라(스크롤 정착 rAF를 재사용) 대기를 내부가 맡는다.
      case "picker.prepareCaptureBySelector":
        handlePrepareCaptureBySelector(
          msg,
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
        activePickerSessionId = msg.sessionId;
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
        // reject하면 sendResponse가 안 나가 채널이 열린 채 남고 사이드패널의 await가 매달린다.
        // 성공한 척 ack를 지어내지 않는다 — undefined가 곧 "중단하라"는 신호다.
        void scrollCaptureTo(scrollSession, msg.y, msg.hideFixed).then(sendResponse, () =>
          sendResponse(undefined),
        );
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
          msg.tool === null
            ? null
            : { tool: msg.tool, color: msg.color, strokeWidth: msg.strokeWidth, opacity: msg.opacity },
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
  if (overlay) {
    // 숨기기 **전에** 세운다 — visibility:hidden은 hit target에서도 빠진다. 이 이유엔
    // 만료가 없다: endCapture가 유실돼도 회수 경로가 둘이라(패널 닫힘 → port disconnect →
    // handleClear, 재픽 → setBlockerVisible(true) → 이유 비움) 타이머는 기계만 늘린다.
    // 단 잔류 시엔 옛 실패(오버레이만 안 보임)와 달리 페이지 입력이 통째로 죽으므로,
    // 저 두 경로 중 하나라도 끊기면 만료를 붙일 것.
    setHoverShield(overlay, "capture-prep", true);
    // 커밋 이유는 여기까지가 임무다 — 캡처가 이어받았으니 넘기고 만료 타이머도 끈다.
    setHoverShield(overlay, "selection-commit", false);
    overlay.hostEl.style.visibility = "hidden";
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

// 캡처가 뒤따르는 응답만 숨김 프레임 커밋을 기다린다 — rect null은 캡처 실패 폴백이라
// 대기가 무의미하고, hidden 탭에서 폴백 지연만 이중으로 얹힌다.
function respondAfterPaint(
  res: PrepareCaptureResponse,
  sendResponse: (r: PrepareCaptureResponse) => void,
): void {
  if (!res.rect) {
    sendResponse(res);
    return;
  }
  void afterPaint()
    .then(() => sendResponse(res))
    // 응답이 핸들러 try/catch 밖으로 나갔다 — 삼키면 사이드패널의 await가 매달린다.
    .catch((err) => console.error("[bugshot] capture prep response failed", err));
}

// iframe 프레임 캡처: inner rect(자기 뷰포트 기준)를 top 좌표로 변환해 응답한다.
// offset 요청이 top overlay 숨김(beginCapturePrep)을 겸하고, viewport는 크롭 scale
// 기준이라 top 크기로 교체. 실패(중첩·타임아웃)면 rect null — 캡처 실패 경로 폴백.
async function respondWithTopRect(
  prep: PrepareCaptureResponse,
  sendResponse: (res: PrepareCaptureResponse) => void,
): Promise<void> {
  if (!prep.rect) {
    sendResponse(prep);
    return;
  }
  // prep을 통째로 펼치고 rect·viewport만 갈아끼운다 — 필드를 골라 옮겨 담으면 그 목록에
  // 없는 필드가 조용히 떨어진다(contextSelector가 그렇게 유실됐다 — POSTMORTEM 2026-08-07).
  const offset = await requestFrameOffset();
  if (!offset) {
    sendResponse({ ...prep, rect: null });
    return;
  }
  const rect = composeTopRect(prep.rect, offset);
  // iframe 자체가 top 뷰포트 밖으로 스크롤된 상태 — 크롭이 빈 화면 조각(1px clamp)으로
  // 유효 이미지처럼 저장되는 것을 막고 캡처 실패(rect null) 경로로 폴백.
  if (!rectIntersectsViewport(rect, offset.topViewport)) {
    sendResponse({ ...prep, rect: null, viewport: offset.topViewport });
    return;
  }
  // 자기 프레임 오버레이 숨김 커밋 대기. top 오버레이 쪽은 offset 응답기가 top realm에서
  // 따로 기다린다 — cross-origin iframe은 렌더러가 갈려 여기서 대신 기다릴 수 없다.
  await afterPaint();
  sendResponse({ ...prep, rect, viewport: offset.topViewport });
}

function viewportRectOf(el: Element): ViewportRect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function handlePrepareCapture(
  msg: Extract<PickerMessage, { type: "picker.prepareCapture" }>,
): PrepareCaptureResponse {
  const viewport = beginCapturePrep();
  const base = { viewport, scrollX: window.scrollX, scrollY: window.scrollY };
  if (!ensureSelectedConnected()) return { ...base, rect: null, contextSelector: null };
  const el = selectedEl!;
  const elementRect = viewportRectOf(el);
  // iframe은 게이트가 자기 뷰포트 기준이라 top 좌표에서의 완전 포함을 보장할 수 없다 —
  // 확장 판정 자체를 하지 않는다(폴백이 곧 현행 동작).
  if (!msg.expandContext || window !== window.top) {
    return { ...base, rect: elementRect, contextSelector: null };
  }
  // != null — 빈 문자열을 "판정한 적 없음"으로 뭉개면 before가 확장에 성공했는데도
  // after가 판정을 처음부터 다시 돌린다(POSTMORTEM 2026-07-29).
  if (msg.contextSelector != null) {
    const saved = msg.contextSelector;
    let found: Element | null = null;
    try {
      found = document.querySelector(saved);
    } catch {
      found = null;
    }
    return {
      ...base,
      ...resolveContextRect({
        saved,
        found,
        target: el,
        contextRect: found ? viewportRectOf(found) : null,
        elementRect,
        viewport,
      }),
    };
  }
  const ancestor = findContextAncestor(el);
  if (ancestor) {
    const contextRect = viewportRectOf(ancestor);
    if (passesContextGates(elementRect, contextRect, viewport)) {
      return { ...base, rect: contextRect, contextSelector: buildSelector(ancestor) };
    }
  }
  return { ...base, rect: elementRect, contextSelector: null };
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
  msg: Extract<PickerMessage, { type: "picker.prepareCaptureBySelector" }>,
  sendResponse: (res: PrepareCaptureResponse) => void,
): void {
  const viewport = beginCapturePrep();
  let el: Element | null = null;
  try {
    el = document.querySelector(msg.selector);
  } catch {
    el = null;
  }
  if (!el) {
    sendResponse({
      rect: null,
      viewport,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      contextSelector: null,
    });
    return;
  }
  const target = el;
  // 확장 판정은 live 참조 없이도 성립한다 — selector로 찾은 요소가 곧 포함 검증의 target이다.
  // iframe은 handlePrepareCapture와 같은 이유(게이트가 자기 뷰포트 기준)로 확장하지 않는다.
  const saved = msg.contextSelector;
  let container: Element | null = null;
  if (msg.expandContext && saved != null && window === window.top) {
    try {
      container = document.querySelector(saved);
    } catch {
      container = null;
    }
  }
  const basisOf = (
    vp: { width: number; height: number },
  ): { rect: ViewportRect; contextSelector: string | null } => {
    const elementRect = viewportRectOf(target);
    if (saved == null || !container) {
      return { rect: elementRect, contextSelector: null };
    }
    return resolveContextRect({
      saved,
      found: container,
      target,
      contextRect: viewportRectOf(container),
      elementRect,
      viewport: vp,
    });
  };
  // 스크롤·화면밖 판정은 확장 대상 기준으로 한다 — 요소만 중앙에 놓으면 컨테이너가 뷰포트를
  // 벗어나 G1에서 떨어지고, 이 경로에서 확장이 사실상 안 걸린다.
  const anchor = container ?? el;
  const rect = viewportRectOf(anchor);
  const outside =
    rect.y < 0 ||
    rect.x < 0 ||
    rect.y + rect.height > window.innerHeight ||
    rect.x + rect.width > window.innerWidth;
  if (!outside) {
    const res = {
      ...basisOf(viewport),
      viewport,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
    void afterPaint()
      .then(() => sendResponse(res))
      .catch((err) =>
        console.error("[bugshot] capture prep response failed", err),
      );
    return;
  }
  if (!capturedScroll) capturedScroll = { x: window.scrollX, y: window.scrollY };
  anchor.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  let responded = false;
  const respond = (measured: boolean) => {
    if (responded) return;
    responded = true;
    const vp = { width: window.innerWidth, height: window.innerHeight };
    const base = { viewport: vp, scrollX: window.scrollX, scrollY: window.scrollY };
    sendResponse(
      measured
        ? { ...base, ...basisOf(vp) }
        : { ...base, rect: null, contextSelector: null },
    );
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => respond(true));
  });
  // hidden 탭에서는 rAF가 발화하지 않아 응답이 매달림 — 캡처 실패(rect null) 경로로 폴백.
  setTimeout(() => respond(false), 500);
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
  if (overlay) {
    overlay.hostEl.style.visibility = "";
    // 이 캡처의 이유만 내린다 — 캡처가 겹친 사이 새 선택이 커밋됐으면 그쪽 방패는 살아야 한다.
    setHoverShield(overlay, "capture-prep", false);
  }
  if (capturedScroll) {
    window.scrollTo(capturedScroll.x, capturedScroll.y);
    capturedScroll = null;
  }
}

// 사이드패널이 picker.start로 실어보낸 앱 theme. overlay는 handleStart 말고도 rebind 복귀·
// area-select 경로에서 재생성되므로, 인자로만 넘기면 그 두 경로가 theme을 잃는다.
let pickerTheme: "light" | "dark" = "light";

function handleStart(frameToken?: string, theme?: "light" | "dark"): void {
  // 사이드패널이 chrome 경로로 broadcast한 token — top은 PRESENT 등록 검증에, 자식은
  // announce에 쓴다(무인증 postMessage 위조 등록 차단).
  setFrameToken(frameToken ?? null);
  pickerTheme = theme ?? "light";
  activePickerSessionId = frameToken ?? null;
  selectionDetachedNotified = false;
  // iframe이면 부모 registry에 등록 — 부모 blocker가 이 프레임 위에서 핸드오프한다.
  if (window !== window.top) announceFrameToParent();
  if (!overlay) {
    removeOrphanOverlay();
    overlay = createOverlay();
  }
  // 생성 시점이 아니라 매 start마다 적용한다 — handleStop은 overlay를 destroy하지 않으므로
  // (destroy는 handleClear뿐) 살아있는 overlay로 두 번째 start가 오면 옛 theme이 남는다.
  setOverlayTheme(overlay, pickerTheme);
  // 누적 프리뷰: 이전 element 변경은 유지(복원 안 함). 변경 없는 현재 element만 정리.
  leaveCurrent();
  selectedEl = null;
  lastHover = null;
  // 시트가 뒤늦게 주입·교체되면(다크모드 토글·SPA 라우트) inspector도 다시 수집한다.
  setOnCacheReloaded(scheduleInspectorRefresh);
  startCssCacheObserver();
  void ensureCssCacheLoaded();
  scheduleInspectorRefresh();
  addHoverListeners();
  setMode("hover");
}

function handleStop(): void {
  removeHoverListeners();
  setMode(selectedEl ? "selected" : "idle");
}

function handleClear(): void {
  areaRestoreAfter = false;
  if (scrollSession) {
    try {
      endScrollCapture(scrollSession);
    } finally {
      scrollSession = null;
    }
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
  activePickerSessionId = null;
  selectionDetachedNotified = false;
  if (rafHandle != null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (selectionUpdateTimer != null) {
    clearTimeout(selectionUpdateTimer);
    selectionUpdateTimer = null;
  }
  if (overlay) {
    destroyOverlay(overlay);
    overlay = null;
  }
  hideAnnotation();
  cancelInspectorRefresh();
  inspectorCache = new WeakMap();
  if (capturedScroll) window.scrollTo(capturedScroll.x, capturedScroll.y);
  capturedScroll = null;
  captureInflight = 0;
  frameOffsetArmCount = 0;
  // 세션 종료 후 옛 token PRESENT가 계속 등록되지 않게 top 검증 상태도 함께 리셋.
  setFrameToken(null);
  setOnCacheReloaded(null);
  stopCssCacheObserver();
  invalidateCssCache();
}

function handleNavigate(direction: "parent" | "child"): void {
  if (!ensureSelectedConnected()) return;
  const next =
    direction === "parent" ? parentOf(selectedEl!) : firstChildOf(selectedEl!);
  if (!next) return;
  leaveCurrent();
  selectedEl = next;
  captureOriginal(next);
  render();
  emitSelected(next, "navigate");
}

function handleApplyClasses(classList: string[]): void {
  if (!ensureSelectedConnected()) return;
  captureOriginal(selectedEl!);
  const el = selectedEl as HTMLElement;
  const state = editedEls.get(selectedEl!);
  if (!state) return;
  applyClassOverlay(el, state, classList);
  inspectorCache.delete(el);
  render();
  scheduleSelectionUpdate();
}

function applyClassOverlay(
  el: HTMLElement,
  state: OriginalState,
  classList: string[],
): void {
  for (const cls of state.classAdded) el.classList.remove(cls);
  for (const cls of state.classRemoved) el.classList.add(cls);
  state.classAdded.clear();
  state.classRemoved.clear();
  const original = new Set((state.className ?? "").split(/\s+/).filter(Boolean));
  const desired = new Set(classList);
  for (const cls of original) {
    if (!desired.has(cls)) {
      el.classList.remove(cls);
      state.classRemoved.add(cls);
    }
  }
  for (const cls of desired) {
    if (!original.has(cls)) {
      el.classList.add(cls);
      state.classAdded.add(cls);
    }
  }
  state.ownershipObserver.takeRecords();
}

// 값 끝 !important를 분리해 priority 인자로 적용 — 2-arg setProperty는
// "red !important"를 무효값으로 조용히 드롭한다. 접미사 없는 값은 기존 경로 그대로.
function handleApplyStyles(inlineStyle: Record<string, string>): void {
  if (!ensureSelectedConnected()) return;
  captureOriginal(selectedEl!);
  const el = selectedEl as HTMLElement;
  const state = editedEls.get(selectedEl!);
  if (!state) return;
  applyStyleOverlay(el, state.styleOverlay, inlineStyle);
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
  applyClassOverlay(h, state, msg.classList);
  applyStyleOverlay(h, state.styleOverlay, msg.inlineStyle);
  if (
    msg.text !== null &&
    state.editable &&
    state.text !== null &&
    msg.text !== state.text
  ) {
    writeEditableText(state.editable, msg.text);
    state.lastAppliedText = msg.text;
    state.ownershipObserver.takeRecords();
  }
  if (isElementClean(el, state)) {
    state.ownershipObserver.disconnect();
    disconnectStyleOverlay(state.styleOverlay);
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
      classAdded: new Set(),
      classRemoved: new Set(),
      style: h.getAttribute("style"),
      styleOverlay: createStyleOverlayState(),
      editable,
      text: editable ? readEditableText(editable) : null,
      lastAppliedText: null,
      ownershipObserver: null as unknown as MutationObserver,
      externalClassMutations: new Set(),
      externalTextMutation: false,
    };
    state.ownershipObserver = new MutationObserver((records) => {
      markExternalOwnershipMutations(state!, records);
    });
    state.ownershipObserver.observe(h, {
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    editedEls.set(el, state);
  }
  return state;
}

// 원본 기록 + 전역 캐시를 현재 element 원본으로 채움.
function captureOriginal(el: Element): void {
  const state = registerOriginal(el);
  editableHandle = state.editable;
}

function restoreElState(el: Element, state: OriginalState): void {
  const h = el as HTMLElement;
  markExternalOwnershipMutations(
    state,
    state.ownershipObserver.takeRecords(),
  );
  for (const cls of state.classAdded) {
    if (!state.externalClassMutations.has(cls)) h.classList.remove(cls);
  }
  for (const cls of state.classRemoved) {
    if (!state.externalClassMutations.has(cls)) h.classList.add(cls);
  }
  state.classAdded.clear();
  state.classRemoved.clear();
  restoreStyleOverlay(h, state.styleOverlay);
  if (
    state.editable &&
    state.text !== null &&
    !state.externalTextMutation &&
    state.lastAppliedText !== null &&
    readEditableText(state.editable) === state.lastAppliedText &&
    shouldRestoreEditable(state.editable, state.text)
  ) {
    restoreEditable(state.editable, state.text);
  }
  state.lastAppliedText = null;
  state.externalClassMutations.clear();
  state.externalTextMutation = false;
  state.ownershipObserver.takeRecords();
}

function markExternalOwnershipMutations(
  state: OriginalState,
  records: MutationRecord[],
): void {
  for (const record of records) {
    if (record.type === "attributes") {
      const before = new Set((record.oldValue ?? "").split(/\s+/).filter(Boolean));
      const target = record.target as Element;
      const after = new Set(Array.from(target.classList));
      const changed = [...new Set([...before, ...after])].filter(
        (cls) => before.has(cls) !== after.has(cls),
      );
      if (changed.length === 0) {
        for (const cls of [...state.classAdded, ...state.classRemoved]) {
          state.externalClassMutations.add(cls);
        }
      } else {
        for (const cls of changed) state.externalClassMutations.add(cls);
      }
    } else state.externalTextMutation = true;
  }
}

// 모든 편집 element 일괄 원복 + 레지스트리·캐시 정리(cleanup 종착점 handleClear에서 호출).
function restoreAll(): void {
  for (const [el, state] of editedEls) {
    restoreElState(el, state);
    state.ownershipObserver.disconnect();
    disconnectStyleOverlay(state.styleOverlay);
  }
  editedEls.clear();
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
    state.ownershipObserver.disconnect();
    disconnectStyleOverlay(state.styleOverlay);
    editedEls.delete(selectedEl);
  }
}

function handleApplyText(text: string): void {
  if (!ensureSelectedConnected()) return;
  captureOriginal(selectedEl!);
  if (!editableHandle) return;
  writeEditableText(editableHandle, text);
  const state = editedEls.get(selectedEl!);
  if (state) state.lastAppliedText = text;
  state?.ownershipObserver.takeRecords();
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
      info = collectInspectorInfo(target);
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
  // blocker가 hit target을 가져가도 이벤트는 document까지 버블한다 — 위임 mousemove·mouseover로
  // 만든 페이지의 hover UI(툴팁·메가메뉴·커스텀 커서)가 picking 중 계속 반응하는 통로다.
  window.addEventListener("mouseover", stopHoverPropagation, true);
  window.addEventListener("mouseout", onMouseOut, true);
  window.addEventListener("keydown", onKeyDown, true);
  if (overlay) {
    overlay.blockerEl.addEventListener("click", onClickCommit);
    overlay.blockerEl.addEventListener("contextmenu", suppressEvent);
    overlay.blockerEl.addEventListener("auxclick", suppressEvent);
    overlay.blockerEl.addEventListener("dblclick", suppressEvent);
    // 버블만 끊어 페이지의 위임 핸들러(드래그 시작·메뉴 개폐)를 막는다. preventDefault는
    // 안 붙인다 — blocker가 target이라 페이지 쪽 포커스·선택이 어차피 시작되지 않고,
    // 취소가 필요한 기본동작(컨텍스트 메뉴·중클릭)은 suppressEvent가 이미 맡는다.
    // pointer 계열은 window capture로 끊으면 안 된다 — action-recorder가 document capture로
    // 듣고 있어 picking 중 사용자 액션 로그가 통째로 빈다. blocker 버블에서만 막는다.
    for (const type of PAGE_HANDLER_EVENTS) {
      overlay.blockerEl.addEventListener(type, stopHoverPropagation);
    }
  }
}

// blocker가 hit target이어도 페이지의 document/window 위임 핸들러까지는 도달하는 이벤트들.
const PAGE_HANDLER_EVENTS = [
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointerover",
] as const;

function removeHoverListeners(): void {
  window.removeEventListener("mousemove", onMouseMove, true);
  window.removeEventListener("mouseover", stopHoverPropagation, true);
  window.removeEventListener("mouseout", onMouseOut, true);
  window.removeEventListener("keydown", onKeyDown, true);
  if (overlay) {
    overlay.blockerEl.removeEventListener("click", onClickCommit);
    overlay.blockerEl.removeEventListener("contextmenu", suppressEvent);
    overlay.blockerEl.removeEventListener("auxclick", suppressEvent);
    overlay.blockerEl.removeEventListener("dblclick", suppressEvent);
    for (const type of PAGE_HANDLER_EVENTS) {
      overlay.blockerEl.removeEventListener(type, stopHoverPropagation);
    }
  }
}

function suppressEvent(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

function stopHoverPropagation(e: Event): void {
  if (mode !== "hover") return;
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
  return withBlockerHitTest(overlay, () => document.elementFromPoint(x, y));
}

function isOwnUi(el: Element | null): boolean {
  if (!el) return true;
  if (!overlay) return false;
  if (el === overlay.hostEl) return true;
  return overlay.hostEl.contains(el);
}

function onMouseMove(e: MouseEvent): void {
  if (mode !== "hover") return;
  e.stopPropagation();
  // 포인팅으로 읽히는 이동이면 스크롤 양보를 회수한다 — 양보 창이 열려 있는 동안은 커서 밑
  // 페이지 요소가 진짜 :hover를 받는다. 직전 휠 직후인지는 overlay가 판정한다.
  if (overlay) cancelBlockerScrollYield(overlay);
  const target = elementAtPoint(e.clientX, e.clientY);
  if (isOwnUi(target) || target === lastHover) return;
  lastHover = target;
  // 등록된 자식 iframe 위에서는 blocker를 투과시켜 안쪽 picker가 이벤트를 받게 한다
  // (핸드오프). 미등록(sandbox·중첩)은 유지 → 클릭이 onClickCommit 거부 경로로.
  const handoff =
    !!target &&
    target.tagName === "IFRAME" &&
    isRegisteredChildFrame(target);
  if (overlay) {
    setBlockerHandoff(overlay, handoff);
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
    if (activePickerSessionId) {
      postToRuntime({
        type: "picker.iframeUnsupported",
        sessionId: activePickerSessionId,
      });
    }
    return;
  }
  leaveCurrent();
  selectedEl = target;
  captureOriginal(target);
  lastHover = null;
  // 전파 차단(removeHoverListeners)과 blocker 철거(setMode) **양쪽보다 먼저** 세운다 —
  // 사이드패널의 before 캡처가 도착하기까지 한 프레임만 열려도 hover가 스냅샷에 굳는다.
  // 내리는 경로는 셋: beginCapturePrep 인계 / 휠(overlay.releaseOnWheel) / 만료 타이머.
  if (overlay) setHoverShield(overlay, "selection-commit", true);
  removeHoverListeners();
  setMode("selected");
  emitSelected(target, "pick");
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
  if (activePickerSessionId) {
    postToRuntime({ type: "picker.cancelled", sessionId: activePickerSessionId });
  }
}

function postSelectionUpdate(el: Element): void {
  if (!activePickerSessionId) return;
  const payload = collectSelection(
    el,
    reuseStableSelector,
    parentOf(el) !== null,
    firstChildOf(el) !== null,
  );
  postToRuntime({
    type: "picker.selectionUpdated",
    sessionId: activePickerSessionId,
    payload: {
      selector: payload.selector,
      specifiedStyles: payload.specifiedStyles,
      propSources: payload.propSources,
      computedStyles: payload.computedStyles,
    },
  });
}

function emitSelected(
  el: Element,
  source: "pick" | "navigate" | "rebind",
): void {
  if (!activePickerSessionId) return;
  selectionDetachedNotified = false;
  const payload = collectSelection(
    el,
    buildStableSelector,
    parentOf(el) !== null,
    firstChildOf(el) !== null,
  );
  postToRuntime({
    type: "picker.selected",
    sessionId: activePickerSessionId,
    source,
    payload,
  });
  void (async () => {
    if (!isCssCacheReady()) {
      await ensureCssCacheLoaded();
      if (selectedEl !== el || !ensureSelectedConnected()) return;
      postSelectionUpdate(el);
    }
    // cross-origin author 보강은 background fetch라 더 늦게 도착 — 2차 selectionUpdated.
    await ensureCrossOriginLoaded();
    if (selectedEl !== el || !ensureSelectedConnected()) return;
    postSelectionUpdate(el);
  })().catch(() => {
    // 보강 실패는 인스펙터 값이 덜 풍부해질 뿐 선택 자체를 막지 않는다 — 삼킨다.
  });
}

let selectionUpdateTimer: number | null = null;

function ensureSelectedConnected(): boolean {
  if (selectedEl?.isConnected && selectedEl.ownerDocument === document) return true;
  if (selectedEl && activePickerSessionId && !selectionDetachedNotified) {
    selectionDetachedNotified = true;
    postToRuntime({
      type: "picker.selectionDetached",
      sessionId: activePickerSessionId,
    });
  }
  return false;
}

function scheduleSelectionUpdate(): void {
  if (selectionUpdateTimer != null) {
    clearTimeout(selectionUpdateTimer);
  }
  selectionUpdateTimer = window.setTimeout(() => {
    selectionUpdateTimer = null;
    if (!ensureSelectedConnected()) return;
    const target = selectedEl!;
    void (async () => {
      await ensureCssCacheLoaded();
      if (selectedEl !== target || !ensureSelectedConnected()) return;
      postSelectionUpdate(target);
      await ensureCrossOriginLoaded();
      if (selectedEl !== target || !ensureSelectedConnected()) return;
      postSelectionUpdate(target);
    })().catch(() => {
      // emitSelected와 같은 이유 — 보강 실패는 선택 자체를 막지 않는다.
    });
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
    setOverlayTheme(overlay, pickerTheme);
    // handleClear가 null화하고 지나간 뒤라 handleStart의 4단(등록·observer·load·priming)을
    // 여기서 다시 세운다 — 등록만 되살리면 inspectorCache가 다음 시트 변경까지 옛 값을 준다.
    setOnCacheReloaded(scheduleInspectorRefresh);
    startCssCacheObserver();
    void ensureCssCacheLoaded();
    scheduleInspectorRefresh();
  }
  leaveCurrent();
  selectedEl = target;
  captureOriginal(target);
  lastHover = null;
  removeHoverListeners();
  if (overlay) clearPreview(overlay);
  setMode("selected");
  emitSelected(target, "rebind");
  return { found: true };
}

/* ── Area Select ─────────────────────────────────── */

function restoreSelected(): void {
  areaRestoreAfter = false;
  if (areaHandle) {
    cancelAreaSelect(areaHandle);
    areaHandle = null;
  }
  setMode("selected");
}

function handleStartAreaSelect(restoreAfter?: boolean): void {
  // 확정 대기(afterPaint) 창에 새 세션이 시작되면 낡은 handle의 settle이 새 세션을 지우고
  // stale areaSelected를 쏜다 — 덮어쓰기 전에 취소해 대기 중 확정을 무효화한다.
  if (areaHandle) {
    cancelAreaSelect(areaHandle);
    areaHandle = null;
  }
  if (!overlay) {
    removeOrphanOverlay();
    overlay = createOverlay();
    setOverlayTheme(overlay, pickerTheme);
  }
  hideOutline(overlay);
  hideBanner(overlay);
  mode = "area-select";
  const shouldRestore = restoreAfter === true && selectedEl !== null;
  // 사이드패널이 몰아주는 취소(handleCancelAreaSelect)도 같은 판단을 써야 한다 —
  // 안 그러면 본문 이미지 삽입을 취소한 것만으로 페이지의 element 편집이 전부 원복된다.
  areaRestoreAfter = shouldRestore;
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
      postToRuntime({
        type: "picker.areaSelected",
        rect,
        viewport,
        sessionId: activePickerSessionId ?? undefined,
      });
      if (shouldRestore) {
        restoreSelected();
      } else {
        mode = "idle";
        handleClear();
      }
    },
    onCancelled() {
      areaHandle = null;
      if (activePickerSessionId) {
        postToRuntime({ type: "picker.cancelled", sessionId: activePickerSessionId });
      }
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
  if (areaRestoreAfter) {
    restoreSelected();
    return;
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
  try {
    endScrollCapture(scrollSession);
  } finally {
    // 복원이 throw해도 세션은 반드시 닫는다 — 안 닫으면 blocker가 남고 다음 begin이
    // 같은 지점에서 다시 죽어 그 탭의 스크롤 캡처가 영구히 안 된다.
    scrollSession = null;
    handleClear();
  }
}
