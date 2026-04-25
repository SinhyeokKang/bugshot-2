import type { ViewportRect } from "@/types/picker";

export interface AreaSelectDeps {
  shadow: ShadowRoot;
  onBlockerRequest(action: "show-crosshair" | "hide"): void;
  onSelected(rect: ViewportRect, viewport: { width: number; height: number }): void;
  onCancelled(): void;
}

export interface AreaSelectHandle {
  _areaSelectEl: HTMLDivElement;
  _areaDimTopEl: HTMLDivElement;
  _areaDimBottomEl: HTMLDivElement;
  _areaDimLeftEl: HTMLDivElement;
  _areaDimRightEl: HTMLDivElement;
  _areaSizeEl: HTMLDivElement;
  _dragStart: { x: number; y: number } | null;
  _dragging: boolean;
  _deps: AreaSelectDeps;
  _onMouseDown: (e: MouseEvent) => void;
  _onMouseMove: (e: MouseEvent) => void;
  _onMouseUp: (e: MouseEvent) => void;
  _onKeyDown: (e: KeyboardEvent) => void;
  _blockerEl: HTMLDivElement | null;
}

export function startAreaSelect(deps: AreaSelectDeps): AreaSelectHandle {
  const { shadow } = deps;

  const areaSelectEl = document.createElement("div");
  areaSelectEl.className = "area-select-rect";
  shadow.appendChild(areaSelectEl);

  const areaDimTopEl = document.createElement("div");
  areaDimTopEl.className = "area-dim";
  const areaDimBottomEl = document.createElement("div");
  areaDimBottomEl.className = "area-dim";
  const areaDimLeftEl = document.createElement("div");
  areaDimLeftEl.className = "area-dim";
  const areaDimRightEl = document.createElement("div");
  areaDimRightEl.className = "area-dim";
  shadow.appendChild(areaDimTopEl);
  shadow.appendChild(areaDimBottomEl);
  shadow.appendChild(areaDimLeftEl);
  shadow.appendChild(areaDimRightEl);

  const areaSizeEl = document.createElement("div");
  areaSizeEl.className = "area-size-label";
  shadow.appendChild(areaSizeEl);

  const handle: AreaSelectHandle = {
    _areaSelectEl: areaSelectEl,
    _areaDimTopEl: areaDimTopEl,
    _areaDimBottomEl: areaDimBottomEl,
    _areaDimLeftEl: areaDimLeftEl,
    _areaDimRightEl: areaDimRightEl,
    _areaSizeEl: areaSizeEl,
    _dragStart: null,
    _dragging: false,
    _deps: deps,
    _onMouseDown: (e) => onMouseDown(handle, e),
    _onMouseMove: (e) => onMouseMove(handle, e),
    _onMouseUp: (e) => onMouseUp(handle, e),
    _onKeyDown: (e) => onKeyDown(handle, e),
    _blockerEl: null,
  };

  showDimming(handle, null);
  deps.onBlockerRequest("show-crosshair");

  window.addEventListener("keydown", handle._onKeyDown, true);

  return handle;
}

export function attachAreaBlockerListener(handle: AreaSelectHandle, blockerEl: HTMLDivElement): void {
  handle._blockerEl = blockerEl;
  blockerEl.addEventListener("mousedown", handle._onMouseDown);
}

export function cancelAreaSelect(handle: AreaSelectHandle): void {
  removeListeners(handle);
  cleanupElements(handle);
  handle._deps.onBlockerRequest("hide");
}

/* ── internal ────────────────────────────────────── */

function removeListeners(h: AreaSelectHandle): void {
  window.removeEventListener("mousemove", h._onMouseMove, true);
  window.removeEventListener("mouseup", h._onMouseUp, true);
  window.removeEventListener("keydown", h._onKeyDown, true);
  if (h._blockerEl) {
    h._blockerEl.removeEventListener("mousedown", h._onMouseDown);
    h._blockerEl = null;
  }
}

function cleanupElements(h: AreaSelectHandle): void {
  h._areaSelectEl.remove();
  h._areaDimTopEl.remove();
  h._areaDimBottomEl.remove();
  h._areaDimLeftEl.remove();
  h._areaDimRightEl.remove();
  h._areaSizeEl.remove();
}

function showDimming(
  h: AreaSelectHandle,
  rect: { x: number; y: number; w: number; h: number } | null,
): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) {
    Object.assign(h._areaDimTopEl.style, { top: "0", left: "0", width: `${vw}px`, height: `${vh}px` });
    h._areaDimBottomEl.style.display = "none";
    h._areaDimLeftEl.style.display = "none";
    h._areaDimRightEl.style.display = "none";
    return;
  }
  Object.assign(h._areaDimTopEl.style, { display: "", top: "0", left: "0", width: `${vw}px`, height: `${rect.y}px` });
  const bottomY = rect.y + rect.h;
  Object.assign(h._areaDimBottomEl.style, { display: "", top: `${bottomY}px`, left: "0", width: `${vw}px`, height: `${vh - bottomY}px` });
  Object.assign(h._areaDimLeftEl.style, { display: "", top: `${rect.y}px`, left: "0", width: `${rect.x}px`, height: `${rect.h}px` });
  const rightX = rect.x + rect.w;
  Object.assign(h._areaDimRightEl.style, { display: "", top: `${rect.y}px`, left: `${rightX}px`, width: `${vw - rightX}px`, height: `${rect.h}px` });
}

function updateAreaRect(h: AreaSelectHandle, e: MouseEvent): void {
  if (!h._dragStart) return;
  const x = Math.min(h._dragStart.x, e.clientX);
  const y = Math.min(h._dragStart.y, e.clientY);
  const w = Math.abs(e.clientX - h._dragStart.x);
  const hh = Math.abs(e.clientY - h._dragStart.y);
  Object.assign(h._areaSelectEl.style, {
    display: "",
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${hh}px`,
  });
  showDimming(h, { x, y, w, h: hh });
  h._areaSizeEl.textContent = `${Math.round(w)} × ${Math.round(hh)}`;
  Object.assign(h._areaSizeEl.style, {
    display: "block",
    left: `${x}px`,
    top: `${Math.max(0, y - 24)}px`,
  });
}

function onMouseDown(h: AreaSelectHandle, e: MouseEvent): void {
  if (e.button !== 0) return;
  e.preventDefault();
  h._dragStart = { x: e.clientX, y: e.clientY };
  h._dragging = true;
  window.addEventListener("mousemove", h._onMouseMove, true);
  window.addEventListener("mouseup", h._onMouseUp, true);
}

function onMouseMove(h: AreaSelectHandle, e: MouseEvent): void {
  updateAreaRect(h, e);
}

function onMouseUp(h: AreaSelectHandle, e: MouseEvent): void {
  window.removeEventListener("mousemove", h._onMouseMove, true);
  window.removeEventListener("mouseup", h._onMouseUp, true);
  if (!h._dragStart) return;
  const x = Math.min(h._dragStart.x, e.clientX);
  const y = Math.min(h._dragStart.y, e.clientY);
  const w = Math.abs(e.clientX - h._dragStart.x);
  const hh = Math.abs(e.clientY - h._dragStart.y);
  if (w < 10 || hh < 10) {
    h._dragStart = null;
    h._dragging = false;
    h._areaSelectEl.style.display = "none";
    h._areaSizeEl.style.display = "none";
    showDimming(h, null);
    return;
  }
  removeListeners(h);
  cleanupElements(h);
  h._deps.onBlockerRequest("hide");
  const rect: ViewportRect = { x, y, width: w, height: hh };
  h._deps.onSelected(rect, { width: window.innerWidth, height: window.innerHeight });
}

function onKeyDown(h: AreaSelectHandle, e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  removeListeners(h);
  cleanupElements(h);
  h._deps.onBlockerRequest("hide");
  h._deps.onCancelled();
}
