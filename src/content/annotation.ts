import { postToRuntime } from "./post-to-runtime";
import { pointsToPath } from "./annotation-draw";

// action-recorder.ts(MAIN world)와 리터럴 동기 복제 — 그쪽 isOwnUi 제외 목록에 같은 값 존재.
export const ANNOTATION_HOST_ID = "__bugshot_annotation_host";

const STROKE_COLOR = "#ef4444";
const STROKE_OUTLINE = "#ffffff";
const STROKE_WIDTH = 3;
const OUTLINE_WIDTH = 6;
const FADE_DELAY_MS = 3000;
const FADE_DURATION_MS = 400;
const SVG_NS = "http://www.w3.org/2000/svg";

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
g.fading {
  opacity: 0;
  transition: opacity ${FADE_DURATION_MS}ms ease-out;
}
`;

interface AnnotationHandle {
  hostEl: HTMLDivElement;
  shadow: ShadowRoot;
  svgEl: SVGSVGElement;
  blockerEl: HTMLDivElement;
  penOn: boolean;
  activeStroke: { groupEl: SVGGElement; points: Array<[number, number]> } | null;
  fadeTimers: Set<ReturnType<typeof setTimeout>>;
  scrollTimer: ReturnType<typeof setTimeout> | null;
}

let handle: AnnotationHandle | null = null;

function newStrokePath(h: AnnotationHandle, e: PointerEvent): void {
  const groupEl = document.createElementNS(SVG_NS, "g");
  const outline = document.createElementNS(SVG_NS, "path");
  outline.setAttribute("fill", "none");
  outline.setAttribute("stroke", STROKE_OUTLINE);
  outline.setAttribute("stroke-width", String(OUTLINE_WIDTH));
  outline.setAttribute("stroke-linecap", "round");
  outline.setAttribute("stroke-linejoin", "round");
  const main = document.createElementNS(SVG_NS, "path");
  main.setAttribute("fill", "none");
  main.setAttribute("stroke", STROKE_COLOR);
  main.setAttribute("stroke-width", String(STROKE_WIDTH));
  main.setAttribute("stroke-linecap", "round");
  main.setAttribute("stroke-linejoin", "round");
  groupEl.appendChild(outline);
  groupEl.appendChild(main);
  h.svgEl.appendChild(groupEl);
  h.activeStroke = { groupEl, points: [[e.clientX, e.clientY]] };
  updateStrokePath(h);
}

function updateStrokePath(h: AnnotationHandle): void {
  if (!h.activeStroke) return;
  const d = pointsToPath(h.activeStroke.points);
  for (const path of Array.from(h.activeStroke.groupEl.children)) {
    path.setAttribute("d", d);
  }
}

function commitStroke(h: AnnotationHandle): void {
  const stroke = h.activeStroke;
  if (!stroke) return;
  h.activeStroke = null;
  const timer = setTimeout(() => {
    h.fadeTimers.delete(timer);
    stroke.groupEl.classList.add("fading");
    stroke.groupEl.addEventListener(
      "transitionend",
      () => stroke.groupEl.remove(),
      { once: true },
    );
  }, FADE_DELAY_MS);
  h.fadeTimers.add(timer);
}

function onPointerMove(e: PointerEvent): void {
  if (!handle || !handle.activeStroke) return;
  handle.activeStroke.points.push([e.clientX, e.clientY]);
  updateStrokePath(handle);
}

function onPointerUp(): void {
  if (!handle) return;
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  commitStroke(handle);
}

function onPointerDown(e: PointerEvent): void {
  if (!handle || !handle.penOn || e.button !== 0) return;
  e.preventDefault();
  newStrokePath(handle, e);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
}

function onKeyDown(e: KeyboardEvent): void {
  if (!handle || !handle.penOn || e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  setAnnotationPen(false);
  postToRuntime({ type: "annotation.penOff" });
}

function yieldToScroll(): void {
  if (!handle) return;
  handle.blockerEl.style.pointerEvents = "none";
  if (handle.scrollTimer) clearTimeout(handle.scrollTimer);
  handle.scrollTimer = setTimeout(() => {
    if (handle?.penOn) handle.blockerEl.style.pointerEvents = "auto";
    if (handle) handle.scrollTimer = null;
  }, 120);
}

function endActiveStroke(h: AnnotationHandle): void {
  if (!h.activeStroke) return;
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  commitStroke(h);
}

export function showAnnotation(): void {
  if (handle || document.getElementById(ANNOTATION_HOST_ID)) return;

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
    shadow,
    svgEl,
    blockerEl,
    penOn: false,
    activeStroke: null,
    fadeTimers: new Set(),
    scrollTimer: null,
  };
}

export function setAnnotationPen(on: boolean): void {
  if (!handle) return;
  if (on) {
    handle.penOn = true;
    handle.blockerEl.classList.add("pen");
    handle.blockerEl.style.pointerEvents = "auto";
    window.addEventListener("keydown", onKeyDown, true);
  } else {
    handle.penOn = false;
    handle.blockerEl.classList.remove("pen");
    handle.blockerEl.style.pointerEvents = "none";
    window.removeEventListener("keydown", onKeyDown, true);
    endActiveStroke(handle);
  }
}

export function hideAnnotation(): void {
  if (!handle) return;
  const h = handle;
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  endActiveStroke(h);
  for (const timer of h.fadeTimers) clearTimeout(timer);
  h.fadeTimers.clear();
  if (h.scrollTimer) clearTimeout(h.scrollTimer);
  h.hostEl.remove();
  handle = null;
}
