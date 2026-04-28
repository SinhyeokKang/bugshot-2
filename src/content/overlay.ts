import type { InspectorInfo } from "./css-resolve";

export interface OverlayHandle {
  hostEl: HTMLDivElement;
  shadow: ShadowRoot;
  blockerEl: HTMLDivElement;
}

interface OverlayInternal extends OverlayHandle {
  bannerEl: HTMLDivElement;
  labelEl: HTMLDivElement;
  marginEl: SVGPathElement;
  paddingEl: SVGPathElement;
  gapEl: SVGPathElement;
  borderEl: SVGRectElement;
  previewEl: SVGRectElement;
  _onResize: () => void;
  _cleanup: () => void;
}

export const HOST_ID = "__bugshot_picker_host";
const SVG_NS = "http://www.w3.org/2000/svg";

const OVERLAY_CSS = `
  :host { all: initial; }
  .banner {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
  }
  .interaction-blocker {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2147483646;
    pointer-events: auto;
    cursor: crosshair;
  }
  .picker-label {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    display: none;
    opacity: 1;
    transition: opacity 120ms ease;
  }
  .picker-label[data-mode="badge"] {
    background: #2563eb;
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font: 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    white-space: nowrap;
  }
  .picker-label[data-mode="inspector"] {
    --popover: hsl(0 0% 100%);
    --popover-foreground: hsl(224 71.4% 4.1%);
    --muted-foreground: hsl(220 8.9% 46.1%);
    --border: hsl(220 13% 91%);
    background: var(--popover);
    color: var(--popover-foreground);
    border: 1px solid var(--border);
    padding: 8px;
    border-radius: 12px;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    min-width: 260px;
    max-width: 300px;
    box-sizing: border-box;
    outline: none;
  }
  .picker-label[data-mode="inspector"] .pl-selector {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  .picker-label[data-mode="inspector"] .pl-selector-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    word-break: break-all;
  }
  .picker-label[data-mode="inspector"] .pl-selector-size {
    flex: 0 0 auto;
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    padding-top: 3px;
  }
  .picker-label[data-mode="inspector"] .pl-extra {
    color: var(--muted-foreground);
    font-weight: 500;
  }
  .picker-label[data-mode="inspector"] .pl-row {
    display: flex;
    align-items: center;
    gap: 12px;
    line-height: 1.5;
    font-size: 12px;
  }
  .picker-label[data-mode="inspector"] .pl-row + .pl-row {
    margin-top: 4px;
  }
  .picker-label[data-mode="inspector"] .pl-key {
    color: var(--muted-foreground);
    flex: 0 0 64px;
  }
  .picker-label[data-mode="inspector"] .pl-val {
    color: var(--popover-foreground);
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .picker-label[data-mode="inspector"] .pl-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-label[data-mode="inspector"] .pl-swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid var(--border);
    flex: 0 0 auto;
  }
  @media (prefers-color-scheme: dark) {
    .picker-label[data-mode="inspector"] {
      --popover: hsl(224 71.4% 4.1%);
      --popover-foreground: hsl(210 20% 98%);
      --muted-foreground: hsl(217.9 10.6% 64.9%);
      --border: hsl(215 27.9% 16.9%);
    }
  }
  .area-dim {
    position: fixed;
    background: rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  .area-select-rect {
    position: fixed;
    border: 2px solid #2563eb;
    background: transparent;
    pointer-events: none;
    display: none;
  }
  .area-size-label {
    position: fixed;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font: 11px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
    display: none;
    white-space: nowrap;
  }
`;

export function createOverlay(): OverlayHandle {
  const hostEl = document.createElement("div");
  hostEl.id = HOST_ID;
  Object.assign(hostEl.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  });
  const shadow = hostEl.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  const blockerEl = document.createElement("div");
  blockerEl.className = "interaction-blocker";
  blockerEl.style.display = "none";
  shadow.appendChild(blockerEl);

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  function yieldToScroll() {
    blockerEl.style.pointerEvents = "none";
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      blockerEl.style.pointerEvents = "auto";
      scrollTimer = null;
    }, 120);
  }
  blockerEl.addEventListener("wheel", yieldToScroll, { passive: true });
  blockerEl.addEventListener("touchmove", yieldToScroll, { passive: true });

  function cleanupBlockerListeners() {
    blockerEl.removeEventListener("wheel", yieldToScroll);
    blockerEl.removeEventListener("touchmove", yieldToScroll);
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  Object.assign(svg.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  });

  const marginEl = document.createElementNS(SVG_NS, "path");
  marginEl.setAttribute("fill", "rgba(246, 178, 107, 0.35)");
  marginEl.setAttribute("fill-rule", "evenodd");
  marginEl.style.display = "none";
  svg.appendChild(marginEl);

  const paddingEl = document.createElementNS(SVG_NS, "path");
  paddingEl.setAttribute("fill", "rgba(147, 196, 125, 0.4)");
  paddingEl.setAttribute("fill-rule", "evenodd");
  paddingEl.style.display = "none";
  svg.appendChild(paddingEl);

  const gapEl = document.createElementNS(SVG_NS, "path");
  gapEl.setAttribute("fill", "rgba(236, 72, 153, 0.3)");
  gapEl.style.display = "none";
  svg.appendChild(gapEl);

  const borderEl = document.createElementNS(SVG_NS, "rect");
  borderEl.setAttribute("fill", "none");
  borderEl.setAttribute("stroke", "#2563eb");
  borderEl.setAttribute("stroke-width", "1");
  borderEl.style.display = "none";
  svg.appendChild(borderEl);

  const previewEl = document.createElementNS(SVG_NS, "rect");
  previewEl.setAttribute("fill", "rgba(251, 146, 60, 0.2)");
  previewEl.setAttribute("stroke", "#f97316");
  previewEl.setAttribute("stroke-width", "2");
  previewEl.setAttribute("stroke-dasharray", "4 2");
  previewEl.style.display = "none";
  svg.appendChild(previewEl);

  shadow.appendChild(svg);

  const labelEl = document.createElement("div");
  labelEl.className = "picker-label";
  labelEl.dataset.mode = "badge";
  shadow.appendChild(labelEl);

  const bannerEl = document.createElement("div");
  bannerEl.className = "banner";
  bannerEl.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  shadow.appendChild(bannerEl);

  const handle: OverlayInternal = {
    hostEl,
    shadow,
    blockerEl,
    bannerEl,
    labelEl,
    marginEl,
    paddingEl,
    gapEl,
    borderEl,
    previewEl,
    _onResize: () => updateBanner(handle),
    _cleanup: cleanupBlockerListeners,
  };

  window.addEventListener("resize", handle._onResize);
  document.documentElement.appendChild(hostEl);
  return handle;
}

export function destroyOverlay(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  window.removeEventListener("resize", o._onResize);
  o._cleanup();
  o.hostEl.remove();
}

export function updateBanner(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.bannerEl.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  o.bannerEl.style.display = "";
}

export function hideBanner(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.bannerEl.style.display = "none";
}

export function setBlockerVisible(
  h: OverlayHandle,
  visible: boolean,
  cursor?: string,
): void {
  h.blockerEl.style.display = visible ? "" : "none";
  if (visible) {
    h.blockerEl.style.pointerEvents = "auto";
    if (cursor) h.blockerEl.style.cursor = cursor;
  }
}

export function renderOutline(
  h: OverlayHandle,
  target: Element,
  opts: { hideBoxModel?: boolean } = {},
): void {
  const o = h as OverlayInternal;
  const rect = target.getBoundingClientRect();
  const bl = rect.left;
  const bt = rect.top;
  const bw = rect.width;
  const bh = rect.height;

  o.borderEl.setAttribute("x", bl.toString());
  o.borderEl.setAttribute("y", bt.toString());
  o.borderEl.setAttribute("width", bw.toString());
  o.borderEl.setAttribute("height", bh.toString());
  o.borderEl.style.display = "";

  if (opts.hideBoxModel) {
    o.marginEl.style.display = "none";
    o.paddingEl.style.display = "none";
    o.gapEl.style.display = "none";
    return;
  }

  const cs = window.getComputedStyle(target);
  const mt = parseFloat(cs.marginTop) || 0;
  const mr = parseFloat(cs.marginRight) || 0;
  const mb = parseFloat(cs.marginBottom) || 0;
  const ml = parseFloat(cs.marginLeft) || 0;
  const pt = parseFloat(cs.paddingTop) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const pb = parseFloat(cs.paddingBottom) || 0;
  const pl = parseFloat(cs.paddingLeft) || 0;

  if (mt || mr || mb || ml) {
    const ox = bl - ml;
    const oy = bt - mt;
    const ow = bw + ml + mr;
    const oh = bh + mt + mb;
    o.marginEl.setAttribute(
      "d",
      `M${ox},${oy} h${ow} v${oh} h${-ow} Z ` +
        `M${bl},${bt} h${bw} v${bh} h${-bw} Z`,
    );
    o.marginEl.style.display = "";
  } else {
    o.marginEl.style.display = "none";
  }

  if (pt || pr || pb || pl) {
    const iw = Math.max(0, bw - pl - pr);
    const ih = Math.max(0, bh - pt - pb);
    o.paddingEl.setAttribute(
      "d",
      `M${bl},${bt} h${bw} v${bh} h${-bw} Z ` +
        `M${bl + pl},${bt + pt} h${iw} v${ih} h${-iw} Z`,
    );
    o.paddingEl.style.display = "";
  } else {
    o.paddingEl.style.display = "none";
  }

  updateGap(o, target, cs, {
    contentLeft: bl + pl,
    contentRight: bl + bw - pr,
    contentTop: bt + pt,
    contentBottom: bt + bh - pb,
  });
}

export function renderBadge(h: OverlayHandle, target: Element): void {
  const o = h as OverlayInternal;
  const tag = target.tagName.toLowerCase();
  const cls = Array.from(target.classList).slice(0, 3).map((c) => `.${c}`).join("");
  const extra = target.classList.length > 3 ? `+${target.classList.length - 3}` : "";

  o.labelEl.textContent = `${tag}${cls}${extra}`;
  o.labelEl.dataset.mode = "badge";
  placeLabel(o, target);
}

export function renderInspector(
  h: OverlayHandle,
  target: Element,
  info: InspectorInfo,
): void {
  const o = h as OverlayInternal;
  o.labelEl.dataset.mode = "inspector";
  o.labelEl.innerHTML = buildInspectorHtml(info);
  placeLabel(o, target);
}

function placeLabel(o: OverlayInternal, target: Element): void {
  const labelEl = o.labelEl;
  const wasHidden = labelEl.style.display !== "block";

  if (wasHidden) {
    labelEl.style.transition = "none";
    labelEl.style.opacity = "0";
  }
  labelEl.style.visibility = "hidden";
  labelEl.style.display = "block";
  labelEl.style.top = "0px";
  labelEl.style.left = "0px";
  const labelRect = labelEl.getBoundingClientRect();
  const lw = labelRect.width;
  const lh = labelRect.height;

  const rect = target.getBoundingClientRect();
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const gap = 2;
  const margin = 8;

  let top = rect.top - lh - gap;
  if (top < margin) {
    const below = rect.bottom + gap;
    top = below + lh > vpH - margin ? margin : below;
  }

  let left = rect.left;
  if (left + lw > vpW - margin) left = rect.right - lw;
  if (left < margin) left = margin;
  if (left + lw > vpW - margin) left = vpW - margin - lw;

  labelEl.style.top = `${top}px`;
  labelEl.style.left = `${left}px`;
  labelEl.style.visibility = "";

  if (wasHidden) {
    void labelEl.offsetWidth;
    labelEl.style.transition = "";
    labelEl.style.opacity = "1";
  }
}

export function hideLabel(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.labelEl.style.display = "none";
}

export function hideOutline(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.marginEl.style.display = "none";
  o.paddingEl.style.display = "none";
  o.gapEl.style.display = "none";
  o.borderEl.style.display = "none";
  o.labelEl.style.display = "none";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(key: string, valHtml: string): string {
  return `<div class="pl-row"><span class="pl-key">${key}</span><span class="pl-val">${valHtml}</span></div>`;
}

function textVal(text: string): string {
  return `<span class="pl-text">${escapeHtml(text)}</span>`;
}

function colorRow(key: string, label: string, swatch: string): string {
  return row(
    key,
    `<span class="pl-swatch" style="background:${escapeHtml(swatch)}"></span>${textVal(label)}`,
  );
}

function buildInspectorHtml(info: InspectorInfo): string {
  const w = info.width.toFixed(2).replace(/\.?0+$/, "");
  const h = info.height.toFixed(2).replace(/\.?0+$/, "");
  const dims = `${w} × ${h}`;
  const fontParts = [info.fontSize, info.fontWeight, info.fontFamily].filter(Boolean);

  const rows: string[] = [];
  rows.push(colorRow("color", info.color, info.colorValue));
  if (info.backgroundColor && info.backgroundColorValue) {
    rows.push(colorRow("bg-color", info.backgroundColor, info.backgroundColorValue));
  }
  rows.push(row("font", textVal(fontParts.join(" / "))));
  if (info.padding) rows.push(row("padding", textVal(info.padding)));
  if (info.borderRadius) rows.push(row("radius", textVal(info.borderRadius)));

  return `<div class="pl-selector"><div class="pl-selector-text">${selectorHtml(info)}</div><div class="pl-selector-size">${escapeHtml(dims)}</div></div>${rows.join("")}`;
}

function selectorHtml(info: InspectorInfo): string {
  const tag = `<span class="pl-tag">${escapeHtml(info.tag)}</span>`;
  const classes = info.classes
    .map((c) => `<span class="pl-class">.${escapeHtml(c)}</span>`)
    .join("");
  const extra =
    info.classOverflow > 0
      ? `<span class="pl-extra">+${info.classOverflow}</span>`
      : "";
  return `${tag}${classes}${extra}`;
}

export function renderPreview(h: OverlayHandle, selector: string): void {
  const o = h as OverlayInternal;
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    target = null;
  }
  if (!target) {
    o.previewEl.style.display = "none";
    return;
  }
  const rect = target.getBoundingClientRect();
  o.previewEl.setAttribute("x", rect.left.toString());
  o.previewEl.setAttribute("y", rect.top.toString());
  o.previewEl.setAttribute("width", rect.width.toString());
  o.previewEl.setAttribute("height", rect.height.toString());
  o.previewEl.style.display = "";
}

export function clearPreview(h: OverlayHandle): void {
  (h as OverlayInternal).previewEl.style.display = "none";
}

/* ── internal ────────────────────────────────────── */

interface Band {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function groupByAxis(rects: DOMRect[], axis: "row" | "col"): Band[] {
  const sorted = [...rects].sort((a, b) =>
    axis === "row" ? a.top - b.top : a.left - b.left,
  );
  const bands: Band[] = [];
  for (const r of sorted) {
    const last = bands[bands.length - 1];
    const overlap =
      last &&
      (axis === "row" ? r.top < last.bottom - 0.5 : r.left < last.right - 0.5);
    if (overlap) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
    } else {
      bands.push({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      });
    }
  }
  return bands;
}

function updateGap(
  o: OverlayInternal,
  target: Element,
  cs: CSSStyleDeclaration,
  content: {
    contentLeft: number;
    contentRight: number;
    contentTop: number;
    contentBottom: number;
  },
): void {
  const display = cs.display;
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid" || display === "inline-grid";
  if (!isFlex && !isGrid) {
    o.gapEl.style.display = "none";
    return;
  }
  const rowGap = parseFloat(cs.rowGap) || 0;
  const colGap = parseFloat(cs.columnGap) || 0;
  if (!rowGap && !colGap) {
    o.gapEl.style.display = "none";
    return;
  }

  const rects = (Array.from(target.children) as HTMLElement[])
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (rects.length < 2) {
    o.gapEl.style.display = "none";
    return;
  }

  const parts: string[] = [];
  const { contentLeft, contentRight, contentTop, contentBottom } = content;

  if (rowGap) {
    const rows = groupByAxis(rects, "row");
    for (let i = 0; i < rows.length - 1; i++) {
      const y = rows[i].bottom;
      const h = rows[i + 1].top - y;
      if (h <= 0.5) continue;
      const w = contentRight - contentLeft;
      if (w <= 0) continue;
      parts.push(`M${contentLeft},${y} h${w} v${h} h${-w} Z`);
    }
  }

  if (colGap) {
    const cols = groupByAxis(rects, "col");
    for (let i = 0; i < cols.length - 1; i++) {
      const x = cols[i].right;
      const w = cols[i + 1].left - x;
      if (w <= 0.5) continue;
      const h = contentBottom - contentTop;
      if (h <= 0) continue;
      parts.push(`M${x},${contentTop} h${w} v${h} h${-w} Z`);
    }
  }

  if (!parts.length) {
    o.gapEl.style.display = "none";
    return;
  }

  o.gapEl.setAttribute("d", parts.join(" "));
  o.gapEl.style.display = "";
}
