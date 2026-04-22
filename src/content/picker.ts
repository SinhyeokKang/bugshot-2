import { finder } from "@medv/finder";
import type {
  DescribeChildrenResponse,
  DescribeInitialResponse,
  PickerMessage,
  PickerSelectionPayload,
  PrepareCaptureResponse,
  Token,
  TokenCategory,
  TreeNode,
} from "@/types/picker";

const HOST_ID = "__bugshot_picker_host";

const INTERESTING_PROPS = [
  "color",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "letter-spacing",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
  "display",
  "position",
  "flex-direction",
  "justify-content",
  "align-items",
  "flex-wrap",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "background-color",
  "opacity",
  "border",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "overflow",
  "overflow-x",
  "overflow-y",
  "text-overflow",
  "white-space",
  "box-shadow",
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
] as const;

const SVG_NS = "http://www.w3.org/2000/svg";

type Mode = "idle" | "hover" | "selected";

let mode: Mode = "idle";
let selectedEl: Element | null = null;
let lastHover: Element | null = null;
let pendingTarget: Element | null = null;
let originalClassName: string | null = null;
let originalStyle: string | null = null;
let textNode: Text | null = null;
let originalTextContent: string | null = null;

let hostEl: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let bannerEl: HTMLDivElement | null = null;
let marginEl: SVGPathElement | null = null;
let paddingEl: SVGPathElement | null = null;
let gapEl: SVGPathElement | null = null;
let borderEl: SVGRectElement | null = null;
let previewEl: SVGRectElement | null = null;

let rafHandle: number | null = null;

chrome.runtime.onMessage.addListener(
  (msg: PickerMessage, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
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
        sendResponse(buildInitialTree());
        return;
      case "picker.describeChildren":
        sendResponse(buildChildrenResponse(msg.selector));
        return;
      case "picker.previewHover":
        handlePreviewHover(msg.selector);
        break;
      case "picker.previewClear":
        handlePreviewClear();
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
      default:
        return;
    }
    sendResponse({ ok: true });
  },
);

function handlePrepareCapture(): PrepareCaptureResponse {
  if (hostEl) hostEl.style.visibility = "hidden";
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
  if (hostEl) hostEl.style.visibility = "";
}

function handleStart(): void {
  ensureOverlay();
  selectedEl = null;
  lastHover = null;
  pendingTarget = null;
  addHoverListeners();
  setMode("hover");
}

function handleStop(): void {
  removeHoverListeners();
  setMode(selectedEl ? "selected" : "idle");
}

function handleClear(): void {
  removeHoverListeners();
  restoreOriginal();
  selectedEl = null;
  lastHover = null;
  setMode("idle");
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

function findEditableTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (t.textContent && t.textContent.trim().length > 0) return t;
  }
  return null;
}

function handleApplyText(text: string): void {
  if (!textNode) return;
  textNode.textContent = text;
  render();
}

function parentOf(el: Element): Element | null {
  const p = el.parentElement;
  if (!p) return null;
  if (p === document.documentElement || p === document.body) return null;
  return p;
}

function firstChildOf(el: Element): Element | null {
  for (const child of Array.from(el.children)) {
    const rect = child.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return child;
  }
  return el.children[0] ?? null;
}

function setMode(next: Mode): void {
  mode = next;
  updateBanner();
  if (mode === "selected") {
    attachViewportListeners();
  } else {
    detachViewportListeners();
  }
  render();
}

function updateBanner(): void {
  if (!bannerEl) return;
  bannerEl.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  bannerEl.style.display = "";
}

function render(): void {
  const target =
    mode === "hover" ? lastHover : mode === "selected" ? selectedEl : null;
  if (!target) {
    hideOverlay();
    return;
  }
  updateOutline(target);
}

function ensureOverlay(): void {
  if (hostEl) return;
  hostEl = document.createElement("div");
  hostEl.id = HOST_ID;
  Object.assign(hostEl.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  });
  shadow = hostEl.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
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
  `;
  shadow.appendChild(style);

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

  marginEl = document.createElementNS(SVG_NS, "path");
  marginEl.setAttribute("fill", "rgba(246, 178, 107, 0.35)");
  marginEl.setAttribute("fill-rule", "evenodd");
  marginEl.style.display = "none";
  svg.appendChild(marginEl);

  paddingEl = document.createElementNS(SVG_NS, "path");
  paddingEl.setAttribute("fill", "rgba(147, 196, 125, 0.4)");
  paddingEl.setAttribute("fill-rule", "evenodd");
  paddingEl.style.display = "none";
  svg.appendChild(paddingEl);

  gapEl = document.createElementNS(SVG_NS, "path");
  gapEl.setAttribute("fill", "rgba(236, 72, 153, 0.3)");
  gapEl.style.display = "none";
  svg.appendChild(gapEl);

  borderEl = document.createElementNS(SVG_NS, "rect");
  borderEl.setAttribute("fill", "none");
  borderEl.setAttribute("stroke", "#2563eb");
  borderEl.setAttribute("stroke-width", "2");
  borderEl.style.display = "none";
  svg.appendChild(borderEl);

  previewEl = document.createElementNS(SVG_NS, "rect");
  previewEl.setAttribute("fill", "rgba(251, 146, 60, 0.2)");
  previewEl.setAttribute("stroke", "#f97316");
  previewEl.setAttribute("stroke-width", "2");
  previewEl.setAttribute("stroke-dasharray", "4 2");
  previewEl.style.display = "none";
  svg.appendChild(previewEl);

  shadow.appendChild(svg);

  bannerEl = document.createElement("div");
  bannerEl.className = "banner";
  bannerEl.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  shadow.appendChild(bannerEl);

  window.addEventListener("resize", updateBanner);

  document.documentElement.appendChild(hostEl);
}

function hideOverlay(): void {
  if (marginEl) marginEl.style.display = "none";
  if (paddingEl) paddingEl.style.display = "none";
  if (gapEl) gapEl.style.display = "none";
  if (borderEl) borderEl.style.display = "none";
}

function addHoverListeners(): void {
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onMouseEat, true);
  window.addEventListener("mousedown", onMouseEat, true);
  window.addEventListener("mouseup", onMouseEat, true);
  window.addEventListener("click", onClickCommit, true);
  window.addEventListener("auxclick", onMouseEat, true);
  window.addEventListener("dblclick", onMouseEat, true);
  window.addEventListener("contextmenu", onMouseEat, true);
  window.addEventListener("keydown", onKeyDown, true);
}

function removeHoverListeners(): void {
  window.removeEventListener("mousemove", onMouseMove, true);
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("pointerup", onMouseEat, true);
  window.removeEventListener("mousedown", onMouseEat, true);
  window.removeEventListener("mouseup", onMouseEat, true);
  window.removeEventListener("click", onClickCommit, true);
  window.removeEventListener("auxclick", onMouseEat, true);
  window.removeEventListener("dblclick", onMouseEat, true);
  window.removeEventListener("contextmenu", onMouseEat, true);
  window.removeEventListener("keydown", onKeyDown, true);
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
  if (!hostEl) return document.elementFromPoint(x, y);
  const prev = hostEl.style.display;
  hostEl.style.display = "none";
  const el = document.elementFromPoint(x, y);
  hostEl.style.display = prev;
  return el;
}

function onMouseMove(e: MouseEvent): void {
  if (mode !== "hover") return;
  const target = elementAtPoint(e.clientX, e.clientY);
  if (!target || target === lastHover) return;
  lastHover = target;
  render();
}

function onPointerDown(e: PointerEvent): void {
  if (mode !== "hover") return;
  if (e.button !== 0) {
    pendingTarget = null;
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  pendingTarget = elementAtPoint(e.clientX, e.clientY);
}

// pointerdown과 click 사이에는 사용자 손가락 시간(수백 ms)이 있으므로,
// mode 전환은 click이 실제 발사된 뒤에 해야 페이지 핸들러/기본 동작을 안전하게 가로챌 수 있다.
function onClickCommit(e: Event): void {
  if (mode !== "hover") return;
  e.preventDefault();
  e.stopPropagation();
  (e as MouseEvent).stopImmediatePropagation?.();
  const target = pendingTarget;
  pendingTarget = null;
  if (!target) return;
  restoreOriginal();
  selectedEl = target;
  captureOriginal(target);
  lastHover = null;
  removeHoverListeners();
  setMode("selected");
  emitSelected(target);
}

function onMouseEat(e: Event): void {
  if (mode !== "hover") return;
  e.preventDefault();
  e.stopPropagation();
  (e as MouseEvent).stopImmediatePropagation?.();
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
  pendingTarget = null;
  setMode("idle");
  chrome.runtime
    .sendMessage<PickerMessage>({ type: "picker.cancelled" })
    .catch(() => {});
}

function emitSelected(el: Element): void {
  const payload = collectSelection(el);
  chrome.runtime
    .sendMessage<PickerMessage>({ type: "picker.selected", payload })
    .catch(() => {});
}

function updateOutline(target: Element): void {
  if (!marginEl || !paddingEl || !gapEl || !borderEl) return;
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
    marginEl.setAttribute(
      "d",
      `M${ox},${oy} h${ow} v${oh} h${-ow} Z ` +
        `M${bl},${bt} h${bw} v${bh} h${-bw} Z`,
    );
    marginEl.style.display = "";
  } else {
    marginEl.style.display = "none";
  }

  if (pt || pr || pb || pl) {
    const iw = Math.max(0, bw - pl - pr);
    const ih = Math.max(0, bh - pt - pb);
    paddingEl.setAttribute(
      "d",
      `M${bl},${bt} h${bw} v${bh} h${-bw} Z ` +
        `M${bl + pl},${bt + pt} h${iw} v${ih} h${-iw} Z`,
    );
    paddingEl.style.display = "";
  } else {
    paddingEl.style.display = "none";
  }

  borderEl.setAttribute("x", bl.toString());
  borderEl.setAttribute("y", bt.toString());
  borderEl.setAttribute("width", bw.toString());
  borderEl.setAttribute("height", bh.toString());
  borderEl.style.display = "";

  updateGap(target, cs, {
    contentLeft: bl + pl,
    contentRight: bl + bw - pr,
    contentTop: bt + pt,
    contentBottom: bt + bh - pb,
  });
}

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
  target: Element,
  cs: CSSStyleDeclaration,
  content: {
    contentLeft: number;
    contentRight: number;
    contentTop: number;
    contentBottom: number;
  },
): void {
  if (!gapEl) return;
  const display = cs.display;
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid" || display === "inline-grid";
  if (!isFlex && !isGrid) {
    gapEl.style.display = "none";
    return;
  }
  const rowGap = parseFloat(cs.rowGap) || 0;
  const colGap = parseFloat(cs.columnGap) || 0;
  if (!rowGap && !colGap) {
    gapEl.style.display = "none";
    return;
  }

  const rects = (Array.from(target.children) as HTMLElement[])
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (rects.length < 2) {
    gapEl.style.display = "none";
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
    gapEl.style.display = "none";
    return;
  }

  gapEl.setAttribute("d", parts.join(" "));
  gapEl.style.display = "";
}

function collectSelection(el: Element): PickerSelectionPayload {
  const selector = buildSelector(el);
  const tagName = el.tagName.toLowerCase();
  const classList = Array.from(el.classList);
  const cs = window.getComputedStyle(el);
  const computedStyles: Record<string, string> = {};
  for (const p of INTERESTING_PROPS) {
    computedStyles[p] = cs.getPropertyValue(p);
  }
  const specifiedStyles = collectSpecifiedStyles(el);
  const editableText = findEditableTextNode(el);
  return {
    selector,
    tagName,
    classList,
    computedStyles,
    specifiedStyles,
    hasParent: parentOf(el) !== null,
    hasChild: firstChildOf(el) !== null,
    text: editableText ? (editableText.textContent ?? "") : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

const INHERITED_PROPS = new Set([
  "color",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "letter-spacing",
]);

const SHORTHAND_MAP: Record<string, string[]> = {
  font: ["font-size", "font-weight", "line-height", "letter-spacing"],
  background: ["background-color"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  gap: ["row-gap", "column-gap"],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  overflow: ["overflow-x", "overflow-y"],
};

function collectRulesForElement(el: Element, out: Record<string, string>): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (rules) collectSpecifiedFromRules(rules, el, out);
    } catch {
      /* cross-origin, skip */
    }
  }
  if (el instanceof HTMLElement) {
    const style = el.style;
    extractVarPropsFromCssText(style.cssText, out);
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      const val = style.getPropertyValue(name);
      if (val && !(out[name]?.includes("var(") && !val.includes("var("))) {
        out[name] = val;
      }
    }
    for (const shorthand of Object.keys(SHORTHAND_MAP)) {
      const val = style.getPropertyValue(shorthand);
      if (val && !(out[shorthand]?.includes("var(") && !val.includes("var("))) {
        out[shorthand] = val;
      }
    }
  }
}

function expandShorthands(all: Record<string, string>): void {
  for (const [shorthand, longhands] of Object.entries(SHORTHAND_MAP)) {
    if (!(shorthand in all)) continue;
    const value = all[shorthand];
    for (const lh of longhands) {
      if (!(lh in all)) all[lh] = value;
    }
  }
}

function collectSpecifiedStyles(el: Element): Record<string, string> {
  const all: Record<string, string> = {};
  collectRulesForElement(el, all);
  expandShorthands(all);

  const missing = [...INHERITED_PROPS].filter((p) => !(p in all));
  if (missing.length > 0) {
    let cur = el.parentElement;
    while (cur && missing.length > 0) {
      const parentAll: Record<string, string> = {};
      collectRulesForElement(cur, parentAll);
      expandShorthands(parentAll);
      for (let i = missing.length - 1; i >= 0; i--) {
        if (missing[i] in parentAll) {
          all[missing[i]] = parentAll[missing[i]];
          missing.splice(i, 1);
        }
      }
      cur = cur.parentElement;
    }
  }

  const filtered: Record<string, string> = {};
  for (const p of INTERESTING_PROPS) {
    if (p in all) filtered[p] = all[p];
  }
  return filtered;
}

function collectSpecifiedFromRules(
  rules: CSSRuleList,
  el: Element,
  out: Record<string, string>,
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      let matched = false;
      try {
        matched = el.matches(rule.selectorText);
      } catch {
        matched = false;
      }
      if (!matched) continue;
      const decl = rule.style;
      extractVarPropsFromCssText(decl.cssText, out);
      for (let i = 0; i < decl.length; i++) {
        const name = decl.item(i);
        if (name.startsWith("--")) continue;
        const val = decl.getPropertyValue(name);
        if (val && !(out[name]?.includes("var(") && !val.includes("var("))) {
          out[name] = val;
        }
      }
      for (const shorthand of Object.keys(SHORTHAND_MAP)) {
        const val = decl.getPropertyValue(shorthand);
        if (val && !(out[shorthand]?.includes("var(") && !val.includes("var("))) {
          out[shorthand] = val;
        }
      }
      continue;
    }
    const nested = (rule as { cssRules?: CSSRuleList }).cssRules;
    if (!nested) continue;
    if (rule instanceof CSSMediaRule) {
      try {
        if (!window.matchMedia(rule.conditionText).matches) continue;
      } catch {
        /* fall through */
      }
      collectSpecifiedFromRules(nested, el, out);
    } else if (rule instanceof CSSSupportsRule) {
      try {
        if (!CSS.supports(rule.conditionText)) continue;
      } catch {
        /* fall through */
      }
      collectSpecifiedFromRules(nested, el, out);
    } else {
      collectSpecifiedFromRules(nested, el, out);
    }
  }
}

const CSS_DECL_RE = /([\w-]+)\s*:\s*([^;]+)/g;

function extractVarPropsFromCssText(
  cssText: string,
  out: Record<string, string>,
): void {
  const declared: Record<string, string> = {};
  CSS_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_DECL_RE.exec(cssText)) !== null) {
    declared[m[1]] = m[2].trim();
  }
  for (const [prop, val] of Object.entries(declared)) {
    if (!val.includes("var(")) continue;
    if (!out[prop] || !out[prop].includes("var(")) out[prop] = val;
    const longhands = SHORTHAND_MAP[prop];
    if (!longhands) continue;
    for (const lh of longhands) {
      if (lh in declared) continue;
      if (!out[lh] || !out[lh].includes("var(")) out[lh] = val;
    }
  }
}

function buildSelector(el: Element): string {
  try {
    return finder(el as HTMLElement, {
      seedMinLength: 2,
      optimizedMinLength: 2,
      timeoutMs: 500,
      maxNumberOfPathChecks: 2000,
    });
  } catch (err) {
    console.warn("[bugshot] finder failed, using path fallback", err);
    return pathSelector(el);
  }
}

function collectTokens(el?: Element): Token[] {
  const seen = new Map<string, string>();
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (rules) collectFromRules(rules, seen);
    } catch {
      /* cross-origin sheet, skip */
    }
  }
  if (el) collectInlineTokens(el, seen);
  const rootStyle = getComputedStyle(document.documentElement);
  const elStyle = el ? getComputedStyle(el) : null;
  const tokens: Token[] = [];
  for (const [name, raw] of seen) {
    let resolved = (elStyle || rootStyle).getPropertyValue(name).trim() || raw;
    if (resolved.startsWith("var(")) {
      resolved = rootStyle.getPropertyValue(name).trim() || raw;
    }
    tokens.push({ name, value: resolved, category: categorizeToken(resolved) });
  }
  tokens.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return tokens;
}

function collectInlineTokens(el: Element, seen: Map<string, string>): void {
  let cur: Element | null = el;
  while (cur) {
    if (cur instanceof HTMLElement && cur.style.length > 0) {
      for (let i = 0; i < cur.style.length; i++) {
        const name = cur.style.item(i);
        if (name.startsWith("--") && !seen.has(name)) {
          seen.set(name, cur.style.getPropertyValue(name).trim());
        }
      }
    }
    cur = cur.parentElement;
  }
}

function collectFromRules(rules: CSSRuleList, seen: Map<string, string>): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const decl = rule.style;
      for (let i = 0; i < decl.length; i++) {
        const name = decl.item(i);
        if (name.startsWith("--") && !seen.has(name)) {
          seen.set(name, decl.getPropertyValue(name).trim());
        }
      }
    } else {
      const nested = (rule as { cssRules?: CSSRuleList }).cssRules;
      if (nested) collectFromRules(nested, seen);
    }
  }
}

function categorizeToken(value: string): TokenCategory {
  const v = value.trim();
  if (!v) return "unknown";
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return "color";
  if (/^(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\(/i.test(v))
    return "color";
  if (/^(transparent|currentColor)$/i.test(v)) return "color";
  if (
    /^-?\d*\.?\d+(px|rem|em|%|vw|vh|ch|ex|vmin|vmax|pt|pc|cm|mm|in)$/.test(v)
  )
    return "length";
  if (/^-?\d*\.?\d+$/.test(v)) return "number";
  return "unknown";
}

function isRenderable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (
    tag === "script" ||
    tag === "style" ||
    tag === "meta" ||
    tag === "link" ||
    tag === "noscript" ||
    tag === "template" ||
    tag === "head"
  ) {
    return false;
  }
  if (el.id === HOST_ID) return false;
  return true;
}

function describeShallow(el: Element): TreeNode {
  const kids = Array.from(el.children).filter(isRenderable);
  return {
    selector: buildSelector(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList),
    childCount: kids.length,
  };
}

function buildInitialTree(): DescribeInitialResponse {
  const target = selectedEl;
  const ancestorChain: Element[] = [];
  if (target) {
    let cur: Element | null = target;
    while (cur) {
      ancestorChain.unshift(cur);
      cur = cur.parentElement;
    }
  }
  const ancestorSet = new Set<Element>(ancestorChain);
  const ancestorPath = ancestorChain.map(buildSelector);

  function expand(el: Element): TreeNode {
    const node = describeShallow(el);
    const kids = Array.from(el.children).filter(isRenderable);
    node.children = kids.map((child) =>
      ancestorSet.has(child) ? expand(child) : describeShallow(child),
    );
    return node;
  }

  if (!target) {
    const root = describeShallow(document.documentElement);
    const kids = Array.from(document.documentElement.children).filter(
      isRenderable,
    );
    root.children = kids.map(describeShallow);
    return { tree: root, ancestorPath: [] };
  }

  return { tree: expand(document.documentElement), ancestorPath };
}

function buildChildrenResponse(selector: string): DescribeChildrenResponse {
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    el = null;
  }
  if (!el) return { children: [] };
  const kids = Array.from(el.children).filter(isRenderable);
  return { children: kids.map(describeShallow) };
}

function handlePreviewHover(selector: string): void {
  if (!previewEl) return;
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    target = null;
  }
  if (!target) {
    previewEl.style.display = "none";
    return;
  }
  const rect = target.getBoundingClientRect();
  previewEl.setAttribute("x", rect.left.toString());
  previewEl.setAttribute("y", rect.top.toString());
  previewEl.setAttribute("width", rect.width.toString());
  previewEl.setAttribute("height", rect.height.toString());
  previewEl.style.display = "";
}

function handlePreviewClear(): void {
  if (previewEl) previewEl.style.display = "none";
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
  handlePreviewClear();
  setMode("selected");
  emitSelected(target);
}

function pathSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter(
      (s) => s.tagName === cur!.tagName,
    );
    if (same.length === 1) {
      parts.unshift(tag);
    } else {
      parts.unshift(`${tag}:nth-of-type(${same.indexOf(cur) + 1})`);
    }
    cur = parent;
  }
  return parts.join(" > ");
}
