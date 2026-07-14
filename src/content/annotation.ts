import { postToRuntime } from "./post-to-runtime";
import { pointsToPath, dropExpired, smoothPoint, rectPoints, PEN_SMOOTHING_ALPHA, type StrokePoint } from "./annotation-draw";

// action-recorder.ts(MAIN world)와 리터럴 동기 복제 — 그쪽 isOwnUi 제외 목록에 같은 값 존재.
export const ANNOTATION_HOST_ID = "__bugshot_annotation_host";

// 점 하나의 수명. 그린 지 이만큼 지난 점부터(먼저 그린 순) 사라진다 — Jam식 트레일 페이드.
const POINT_LIFETIME_MS = 3000;
const SVG_NS = "http://www.w3.org/2000/svg";

// 획 스타일(색/두께/투명도) — sidepanel이 tool·color·thickness로 계산해 실어 보낸 값.
interface PenStyle {
  // rect는 드래그로 사각형을 그린다(자유곡선이 아니라) — 렌더 분기의 유일한 근거.
  tool: "pen" | "rect" | "highlight";
  color: string;
  strokeWidth: number;
  opacity: number;
}

const ANNOTATION_CSS = `
:host { all: initial; }
.blocker {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
}
.blocker.pen {
  pointer-events: auto;
  cursor: crosshair;
  touch-action: none;
}
svg {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 2147483645;
  overflow: visible;
}
`;

interface Stroke {
  // <g> 래퍼는 e2e(svg g 카운트)·구조 일관성용, path는 실제 렌더 대상(그룹당 1개).
  groupEl: SVGGElement;
  pathEl: SVGPathElement;
  points: StrokePoint[];
  // rect 전용: 드래그 시작점·시각. 매 move마다 이 앵커로 사각형을 다시 만든다(점을 누적하지 않는다).
  rectAnchor?: { x: number; y: number; drawnAt: number };
}

interface AnnotationHandle {
  hostEl: HTMLDivElement;
  svgEl: SVGSVGElement;
  blockerEl: HTMLDivElement;
  // 현재 그리기 스타일. null이면 그리기 off(pass-through).
  pen: PenStyle | null;
  // 그려진(그려지는 중 포함) 모든 획. 매 프레임 꼬리부터 트리밍되고 빈 획은 제거된다.
  strokes: Stroke[];
  activeStroke: Stroke | null;
  rafId: number | null;
  scrollTimer: ReturnType<typeof setTimeout> | null;
}

let handle: AnnotationHandle | null = null;

function now(): number {
  return performance.now();
}

function newStrokePath(h: AnnotationHandle, e: PointerEvent): void {
  const pen = h.pen;
  if (!pen) return;
  // pointerup 유실(뷰포트 밖 release)·pointercancel·멀티터치로 이전 획이 남아 있으면 놓는다
  // (strokes에 남아 rAF 루프가 계속 페이드시킨다).
  h.activeStroke = null;
  // 획당 단일 path. 스타일을 엘리먼트에 박아둬 트레일 페이드 중 스타일 변경에 영향받지 않는다.
  // Konva 벡터와 동일하게 흰 아웃라인 없음.
  const groupEl = document.createElementNS(SVG_NS, "g");
  const pathEl = document.createElementNS(SVG_NS, "path");
  pathEl.setAttribute("fill", "none");
  pathEl.setAttribute("stroke", pen.color);
  pathEl.setAttribute("stroke-width", String(pen.strokeWidth));
  pathEl.setAttribute("stroke-opacity", String(pen.opacity));
  pathEl.setAttribute("stroke-linecap", "round");
  pathEl.setAttribute("stroke-linejoin", "round");
  groupEl.appendChild(pathEl);
  h.svgEl.appendChild(groupEl);
  const t = now();
  const stroke: Stroke =
    pen.tool === "rect"
      ? {
          groupEl,
          pathEl,
          points: rectPoints([e.clientX, e.clientY], [e.clientX, e.clientY], t),
          rectAnchor: { x: e.clientX, y: e.clientY, drawnAt: t },
        }
      : { groupEl, pathEl, points: [[e.clientX, e.clientY, t]] };
  h.strokes.push(stroke);
  h.activeStroke = stroke;
  renderStroke(stroke);
  startTicking(h);
}

function renderStroke(s: Stroke): void {
  s.pathEl.setAttribute("d", pointsToPath(s.points));
}

// 매 프레임 모든 획의 앞쪽 만료 점을 잘라 그린 순서대로 꼬리부터 사라지게 한다.
// 활성 획은 비어도 남겨두고(계속 그릴 수 있게), 그 외 빈 획은 DOM에서 제거.
// 남은 획이 없으면 루프를 멈춘다(다음 pointerdown이 재기동). 백그라운드 탭에선 rAF가
// 멈춰 페이드가 얼지만, 그리기 자체가 보이는 탭을 요구하므로 복귀 시 정리된다.
function tick(h: AnnotationHandle): void {
  const t = now();
  for (let i = h.strokes.length - 1; i >= 0; i--) {
    const s = h.strokes[i];
    s.points = dropExpired(s.points, t, POINT_LIFETIME_MS);
    if (s.points.length === 0 && s !== h.activeStroke) {
      s.groupEl.remove();
      h.strokes.splice(i, 1);
    } else {
      renderStroke(s);
    }
  }
  h.rafId = h.strokes.length > 0 ? requestAnimationFrame(() => tick(h)) : null;
}

function startTicking(h: AnnotationHandle): void {
  if (h.rafId === null) h.rafId = requestAnimationFrame(() => tick(h));
}

function addDragListeners(): void {
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onStrokeEnd, true);
  window.addEventListener("pointercancel", onStrokeEnd, true);
}

function removeDragListeners(): void {
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onStrokeEnd, true);
  window.removeEventListener("pointercancel", onStrokeEnd, true);
}

function onPointerMove(e: PointerEvent): void {
  if (!handle || !handle.activeStroke) return;
  const anchor = handle.activeStroke.rectAnchor;
  if (anchor) {
    // 사각형은 점을 누적하지 않고 앵커→현재점으로 매번 다시 만든다.
    handle.activeStroke.points = rectPoints(
      [anchor.x, anchor.y],
      [e.clientX, e.clientY],
      anchor.drawnAt,
    );
    renderStroke(handle.activeStroke);
    return;
  }
  const pts = handle.activeStroke.points;
  // 정지 상태로 3초를 넘기면 tick이 활성 획의 점까지 전부 만료시켜 pts가 빌 수 있다.
  // 그 경우 스무딩할 직전 점이 없으므로 raw로 재시작. 아니면 직전(스무딩된) 점 기준 EMA
  // — Konva pen/highlight와 동일한 손떨림 보정.
  const last = pts.length > 0 ? pts[pts.length - 1] : null;
  const [sx, sy] = last
    ? smoothPoint([last[0], last[1]], [e.clientX, e.clientY], PEN_SMOOTHING_ALPHA)
    : [e.clientX, e.clientY];
  pts.push([sx, sy, now()]);
  renderStroke(handle.activeStroke);
}

// pointerup·pointercancel(터치 스크롤 제스처 회수) 공통 종료 경로.
function onStrokeEnd(): void {
  if (handle) endActiveStroke(handle);
}

function onPointerDown(e: PointerEvent): void {
  if (!handle || !handle.pen || e.button !== 0) return;
  e.preventDefault();
  newStrokePath(handle, e);
  addDragListeners();
}

function onKeyDown(e: KeyboardEvent): void {
  if (!handle || !handle.pen || e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  setAnnotationTool(null, null);
  postToRuntime({ type: "annotation.penOff" });
}

function yieldToScroll(): void {
  // 획을 그리는 중이면 스크롤에 양보하지 않는다 — 양보하면 pointer-events가 풀려 획이 끊긴다.
  if (!handle || handle.activeStroke) return;
  handle.blockerEl.style.pointerEvents = "none";
  if (handle.scrollTimer) clearTimeout(handle.scrollTimer);
  handle.scrollTimer = setTimeout(() => {
    if (handle?.pen) handle.blockerEl.style.pointerEvents = "auto";
    if (handle) handle.scrollTimer = null;
  }, 120);
}

function endActiveStroke(h: AnnotationHandle): void {
  if (!h.activeStroke) return;
  removeDragListeners();
  // 획을 놓기만 하면 strokes에 남아 rAF 루프가 꼬리부터 계속 페이드시킨다.
  h.activeStroke = null;
}

export function showAnnotation(): void {
  if (handle) return;
  // 확장 reload/update로 옛 content script의 host DOM만 남으면(handle=null) 재-show가 영구 차단되므로
  // picker의 removeOrphanOverlay 선례대로 고아 host를 제거하고 새로 마운트한다.
  document.getElementById(ANNOTATION_HOST_ID)?.remove();

  const hostEl = document.createElement("div");
  hostEl.id = ANNOTATION_HOST_ID;
  Object.assign(hostEl.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  });
  const shadow = hostEl.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = ANNOTATION_CSS;
  shadow.appendChild(style);

  const svgEl = document.createElementNS(SVG_NS, "svg");
  shadow.appendChild(svgEl);

  const blockerEl = document.createElement("div");
  blockerEl.className = "blocker";
  blockerEl.addEventListener("pointerdown", onPointerDown);
  blockerEl.addEventListener("wheel", yieldToScroll, { passive: true });
  blockerEl.addEventListener("touchmove", yieldToScroll, { passive: true });
  shadow.appendChild(blockerEl);

  document.documentElement.appendChild(hostEl);
  handle = {
    hostEl,
    svgEl,
    blockerEl,
    pen: null,
    strokes: [],
    activeStroke: null,
    rafId: null,
    scrollTimer: null,
  };
}

// tool=null이면 그리기 off(pass-through). 그 외엔 style(color/strokeWidth/opacity)로 획을 그린다.
export function setAnnotationTool(
  tool: "pen" | "rect" | "highlight" | null,
  style: PenStyle | null,
): void {
  if (!handle) return;
  if (tool === null || !style) {
    handle.pen = null;
    handle.blockerEl.classList.remove("pen");
    handle.blockerEl.style.pointerEvents = "none";
    window.removeEventListener("keydown", onKeyDown, true);
    endActiveStroke(handle);
    return;
  }
  handle.pen = style;
  handle.blockerEl.classList.add("pen");
  handle.blockerEl.style.pointerEvents = "auto";
  window.addEventListener("keydown", onKeyDown, true);
}

export function hideAnnotation(): void {
  if (!handle) return;
  const h = handle;
  window.removeEventListener("keydown", onKeyDown, true);
  removeDragListeners();
  endActiveStroke(h);
  if (h.rafId !== null) cancelAnimationFrame(h.rafId);
  if (h.scrollTimer) clearTimeout(h.scrollTimer);
  h.hostEl.remove();
  handle = null;
}
