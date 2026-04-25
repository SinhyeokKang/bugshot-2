export interface OverlayHandle {
  hostEl: HTMLDivElement;
  shadow: ShadowRoot;
  blockerEl: HTMLDivElement;
}

interface OverlayInternal extends OverlayHandle {
  bannerEl: HTMLDivElement;
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

  const bannerEl = document.createElement("div");
  bannerEl.className = "banner";
  bannerEl.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  shadow.appendChild(bannerEl);

  const handle: OverlayInternal = {
    hostEl,
    shadow,
    blockerEl,
    bannerEl,
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

export function renderOutline(h: OverlayHandle, target: Element): void {
  const o = h as OverlayInternal;
  const rect = target.getBoundingClientRect();
  const cs = window.getComputedStyle(target);
  const mt = parseFloat(cs.marginTop) || 0;
  const mr = parseFloat(cs.marginRight) || 0;
  const mb = parseFloat(cs.marginBottom) || 0;
  const ml = parseFloat(cs.marginLeft) || 0;
  const pt = parseFloat(cs.paddingTop) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const pb = parseFloat(cs.paddingBottom) || 0;
  const pl = parseFloat(cs.paddingLeft) || 0;

  const bl = rect.left;
  const bt = rect.top;
  const bw = rect.width;
  const bh = rect.height;

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

  o.borderEl.setAttribute("x", bl.toString());
  o.borderEl.setAttribute("y", bt.toString());
  o.borderEl.setAttribute("width", bw.toString());
  o.borderEl.setAttribute("height", bh.toString());
  o.borderEl.style.display = "";

  updateGap(o, target, cs, {
    contentLeft: bl + pl,
    contentRight: bl + bw - pr,
    contentTop: bt + pt,
    contentBottom: bt + bh - pb,
  });
}

export function hideOutline(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.marginEl.style.display = "none";
  o.paddingEl.style.display = "none";
  o.gapEl.style.display = "none";
  o.borderEl.style.display = "none";
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
