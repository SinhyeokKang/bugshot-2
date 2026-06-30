import type {
  PickerSelectionPayload,
  Token,
  TokenCategory,
} from "@/types/picker";
import {
  getCrossOriginCustomProps,
  getMatchingRules,
  getMatchingCrossOriginRules,
  getRawDeclarationsFor,
  type CrossOriginRule,
} from "./css-source-cache";
import { NAMED_COLORS } from "@/lib/named-colors";

export const INTERESTING_PROPS = [
  "color",
  "font-family",
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
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
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
  "background-image",
  "opacity",
  "border",
  "border-style",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
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
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "transition-delay",
] as const;

const INHERITED_PROPS = new Set([
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "letter-spacing",
]);

const SHORTHAND_MAP: Record<string, string[]> = {
  font: [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
  ],
  background: ["background-color"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  "padding-inline": ["padding-left", "padding-right"],
  "padding-block": ["padding-top", "padding-bottom"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  "margin-inline": ["margin-left", "margin-right"],
  "margin-block": ["margin-top", "margin-bottom"],
  gap: ["row-gap", "column-gap"],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  "border-width": [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ],
  "border-color": [
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
  ],
  "border-style": [
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
  ],
  overflow: ["overflow-x", "overflow-y"],
};

const TRBL_SHORTHANDS: Record<string, [string, string, string, string]> = {
  padding: [
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ],
  margin: [
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
  ],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  "border-width": [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ],
  "border-color": [
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
  ],
  "border-style": [
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
  ],
};

const BORDER_STYLE_KEYWORDS = new Set([
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

// border / border-{side} shorthand → 영향받는 변. per-side(구체)를 먼저 두어 fill-if-absent에서
// `border-bottom`이 `border`보다 우선하도록(전개 순서 = 우선순위).
const BORDER_SHORTHAND_SIDES: Record<string, readonly string[]> = {
  "border-top": ["top"],
  "border-right": ["right"],
  "border-bottom": ["bottom"],
  "border-left": ["left"],
  border: ["top", "right", "bottom", "left"],
};

const VAR_REF_RE = /var\(\s*(--[\w-]+)(?:\s*,\s*([^)]*))?\)/g;
const SIMPLE_VAR_FALLBACK_RE = /^\s*var\(\s*(--[\w-]+)(?:\s*,\s*[^)]*)?\s*\)\s*$/;
const CSS_DECL_RE = /([\w-]+)\s*:\s*([^;]+)/g;

// length 단위 단일 출처 — categorizeToken·isBorderWidthToken이 공유(목록 불일치 방지).
const LENGTH_UNITS =
  "px|rem|em|%|vw|vh|vi|vb|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|ch|ex|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|cm|mm|in|q";
const LENGTH_TOKEN_RE = new RegExp(`^-?\\d*\\.?\\d+(${LENGTH_UNITS})$`, "i");
const LENGTH_IN_FN_RE = new RegExp(`\\d\\s*(${LENGTH_UNITS})\\b`, "i");
const BORDER_WIDTH_NUM_RE = new RegExp(
  `^-?\\d*\\.?\\d+(${LENGTH_UNITS})?$`,
  "i",
);

/* ── public ──────────────────────────────────────── */

export function collectSelection(
  el: Element,
  buildSelectorFn: (el: Element) => string,
  hasParent: boolean,
  hasChild: boolean,
): PickerSelectionPayload {
  const selector = buildSelectorFn(el);
  const tagName = el.tagName.toLowerCase();
  const classList = Array.from(el.classList);
  const cs = window.getComputedStyle(el);
  const computedStyles: Record<string, string> = {};
  for (const p of INTERESTING_PROPS) {
    computedStyles[p] = cs.getPropertyValue(p);
  }
  const { styles: specifiedStyles, sources: propSources } =
    collectSpecifiedStylesWithSources(el);
  const editableHandle = captureEditable(el);
  return {
    selector,
    tagName,
    classList,
    computedStyles,
    specifiedStyles,
    propSources,
    hasParent,
    hasChild,
    text: editableHandle ? readEditableText(editableHandle) : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export function collectSpecifiedStylesWithSources(el: Element): {
  styles: Record<string, string>;
  sources: Record<string, string>;
} {
  const all: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const customProps: Record<string, string> = {};
  collectRulesForElement(el, all, sources, customProps);
  expandShorthands(all, sources);

  const missing = [...INHERITED_PROPS].filter((p) => !(p in all));
  if (missing.length > 0) {
    let cur = el.parentElement;
    while (cur && missing.length > 0) {
      const parentAll: Record<string, string> = {};
      const parentSources: Record<string, string> = {};
      collectRulesForElement(cur, parentAll, parentSources, customProps);
      expandShorthands(parentAll, parentSources);
      for (let i = missing.length - 1; i >= 0; i--) {
        const p = missing[i];
        if (p in parentAll) {
          all[p] = parentAll[p];
          if (parentSources[p]) sources[p] = `${parentSources[p]} ↑`;
          missing.splice(i, 1);
        }
      }
      cur = cur.parentElement;
    }
  }

  for (const prop of Object.keys(all)) {
    all[prop] = resolveVarChain(all[prop], customProps);
  }

  const filtered: Record<string, string> = {};
  const filteredSources: Record<string, string> = {};
  for (const p of INTERESTING_PROPS) {
    if (p in all) {
      filtered[p] = all[p];
      if (sources[p]) filteredSources[p] = sources[p];
    }
  }
  return { styles: filtered, sources: filteredSources };
}

export interface InspectorSpecRefs {
  color?: string;
  backgroundColor?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomRightRadius?: string;
  borderBottomLeftRadius?: string;
  fontSize?: string;
  fontWeight?: string;
}

const INSPECTOR_INHERITED = ["color", "font-size", "font-weight"] as const;

const INSPECTOR_WANTED = new Set([
  "color",
  "background",
  "background-color",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-inline",
  "padding-block",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "font",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "letter-spacing",
]);

export function collectInspectorSpecRefs(el: Element): InspectorSpecRefs {
  const all: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const customProps: Record<string, string> = {};
  collectRulesForElement(el, all, sources, customProps, INSPECTOR_WANTED);
  expandShorthands(all, sources);

  const missing = INSPECTOR_INHERITED.filter((p) => !(p in all));
  if (missing.length > 0) {
    let cur = el.parentElement;
    while (cur && missing.length > 0) {
      const parentAll: Record<string, string> = {};
      const parentSources: Record<string, string> = {};
      collectRulesForElement(cur, parentAll, parentSources, customProps, INSPECTOR_WANTED);
      expandShorthands(parentAll, parentSources);
      for (let i = missing.length - 1; i >= 0; i--) {
        const p = missing[i];
        if (p in parentAll) {
          all[p] = parentAll[p];
          missing.splice(i, 1);
        }
      }
      cur = cur.parentElement;
    }
  }

  const get = (k: string): string | undefined =>
    all[k] ? resolveVarChain(all[k], customProps) : undefined;

  return {
    color: get("color"),
    backgroundColor: get("background-color"),
    paddingTop: get("padding-top"),
    paddingRight: get("padding-right"),
    paddingBottom: get("padding-bottom"),
    paddingLeft: get("padding-left"),
    borderTopLeftRadius: get("border-top-left-radius"),
    borderTopRightRadius: get("border-top-right-radius"),
    borderBottomRightRadius: get("border-bottom-right-radius"),
    borderBottomLeftRadius: get("border-bottom-left-radius"),
    fontSize: get("font-size"),
    fontWeight: get("font-weight"),
  };
}

export function collectTokens(el?: Element): Token[] {
  const seen = new Map<string, string>();
  for (const sheet of allStyleSheets()) {
    try {
      const rules = sheet.cssRules;
      if (rules) collectFromRules(rules, seen);
    } catch {
      /* cross-origin sheet, skip */
    }
  }
  if (el) {
    collectInlineTokens(el, seen);
    collectReferencedTokenNames(collectSpecifiedStylesWithSources(el).styles, seen);
  }
  mergeCrossOriginTokens(seen, getCrossOriginCustomProps());
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
  tokens.sort((a, b) => {
    const ai = a.name.lastIndexOf("-");
    const bi = b.name.lastIndexOf("-");
    const ap = a.name.slice(0, ai);
    const bp = b.name.slice(0, bi);
    if (ap === bp && ap.length > 0) {
      const as = a.name.slice(ai + 1);
      const bs = b.name.slice(bi + 1);
      if (!/\d/.test(as) && !/\d/.test(bs)) {
        const an = parseFloat(a.value);
        const bn = parseFloat(b.value);
        if (!isNaN(an) && !isNaN(bn)) return an - bn;
      }
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  return tokens;
}

export interface InspectorInfo {
  tag: string;
  classes: string[];
  classOverflow: number;
  width: number;
  height: number;
  color: string;
  colorValue: string;
  backgroundColor?: string;
  backgroundColorValue?: string;
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
  padding?: string;
  borderRadius?: string;
}

export type TokenLookup = Map<string, string>;

export function buildTokenLookup(el?: Element): TokenLookup {
  const tokens = collectTokens(el);
  const map: TokenLookup = new Map();
  for (const t of tokens) {
    const key = normalizeForLookup(t.value);
    if (key && !map.has(key)) map.set(key, t.name);
  }
  return map;
}

export function collectInspectorInfo(
  el: Element,
  tokens?: TokenLookup,
): InspectorInfo {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  const tag = el.tagName.toLowerCase();
  const allClasses = Array.from(el.classList);
  const classes = allClasses.slice(0, 3);
  const classOverflow = Math.max(0, allClasses.length - 3);

  const refs = collectInspectorSpecRefs(el);

  const colorValue = formatColor(cs.color) ?? cs.color;
  const color =
    firstVarName(refs.color) ?? matchToken(colorValue, tokens) ?? colorValue;

  const bgValue = formatColor(cs.backgroundColor);
  const backgroundColor = bgValue
    ? (firstVarName(refs.backgroundColor) ??
      matchToken(bgValue, tokens) ??
      bgValue)
    : undefined;
  const backgroundColorValue = bgValue;

  const family = parseFirstFontFamily(cs.fontFamily);
  const fontSize =
    firstVarName(refs.fontSize) ?? matchToken(cs.fontSize, tokens) ?? cs.fontSize;
  const fontWeight =
    firstVarName(refs.fontWeight) ??
    matchToken(cs.fontWeight, tokens) ??
    cs.fontWeight;

  return {
    tag,
    classes,
    classOverflow,
    width: rect.width,
    height: rect.height,
    color,
    colorValue,
    backgroundColor,
    backgroundColorValue,
    fontSize,
    fontWeight,
    fontFamily: family,
    padding: resolveBoxLabel(
      [refs.paddingTop, refs.paddingRight, refs.paddingBottom, refs.paddingLeft],
      [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
      tokens,
    ),
    borderRadius: resolveBoxLabel(
      [
        refs.borderTopLeftRadius,
        refs.borderTopRightRadius,
        refs.borderBottomRightRadius,
        refs.borderBottomLeftRadius,
      ],
      [
        cs.borderTopLeftRadius,
        cs.borderTopRightRadius,
        cs.borderBottomRightRadius,
        cs.borderBottomLeftRadius,
      ],
      tokens,
    ),
  };
}

function resolveBoxLabel(
  refs: [string?, string?, string?, string?],
  computed: [string, string, string, string],
  tokens?: TokenLookup,
): string | undefined {
  if (computed.every((v) => parseFloat(v) === 0)) return undefined;
  const labels: [string, string, string, string] = [
    firstVarName(refs[0]) ?? matchToken(computed[0], tokens) ?? computed[0],
    firstVarName(refs[1]) ?? matchToken(computed[1], tokens) ?? computed[1],
    firstVarName(refs[2]) ?? matchToken(computed[2], tokens) ?? computed[2],
    firstVarName(refs[3]) ?? matchToken(computed[3], tokens) ?? computed[3],
  ];
  const [t, r, b, l] = labels;
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

function firstVarName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = value.match(/var\(\s*(--[^\s,)]+)/);
  if (!m) return undefined;
  const name = m[1];
  if (name.startsWith("--_") || name.startsWith("--tw-")) return undefined;
  return name;
}

function matchToken(value: string, tokens?: TokenLookup): string | undefined {
  if (!tokens || !value) return undefined;
  const key = normalizeForLookup(value);
  return key ? tokens.get(key) : undefined;
}

function normalizeForLookup(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  const c = formatColor(trimmed);
  if (c) return c.toUpperCase();
  return trimmed.toLowerCase();
}

function formatColor(value: string): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v === "transparent" || v === "rgba(0, 0, 0, 0)") return undefined;
  let r: number, g: number, b: number, a = 1;
  const rgbM = v.match(
    /^rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/,
  );
  const hexM = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (rgbM) {
    r = parseInt(rgbM[1], 10);
    g = parseInt(rgbM[2], 10);
    b = parseInt(rgbM[3], 10);
    a = rgbM[4] !== undefined ? parseFloat(rgbM[4]) : 1;
  } else if (hexM) {
    // 단축 hex(#abc/#abcf)를 6/8자리로 펼쳐 rgb 경로와 같은 키로 정규화 —
    // 안 하면 `#fff` 토큰이 computed `rgb(255,255,255)`와 매칭 실패.
    let h = hexM[1];
    if (h.length === 3 || h.length === 4)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    if (h.length !== 6 && h.length !== 8) return v;
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
    a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  } else {
    return v;
  }
  if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function parseFirstFontFamily(value: string): string {
  if (!value) return "";
  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "");
}

export function findEditableTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (t.textContent && t.textContent.trim().length > 0) return t;
  }
  return null;
}

export type EditableToken = { kind: "text"; value: string } | { kind: "br" };

export function tokenizeEditableText(text: string): EditableToken[] {
  const parts = text.split("\n");
  const out: EditableToken[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out.push({ kind: "br" });
    out.push({ kind: "text", value: parts[i] });
  }
  return out;
}

export function serializeEditableTokens(tokens: readonly EditableToken[]): string {
  return tokens.map((t) => (t.kind === "br" ? "\n" : t.value)).join("");
}

export type EditableHandle =
  | { kind: "single"; node: Text }
  | { kind: "flat"; el: Element; originalChildren: Node[] }
  | {
      kind: "multi";
      parent: Element;
      nodes: Array<Text | HTMLBRElement>;
      originalChildren: Node[];
    };

export type EditableChildLike = {
  readonly nodeType: number;
  readonly tagName?: string;
  readonly textContent?: string | null;
};
export type EditableModeClassification =
  | "none"
  | "single"
  | "multi-existing-br"
  | "multi-promote-text";

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

export function classifyEditableChildren(
  children: readonly EditableChildLike[],
): EditableModeClassification {
  if (children.length === 0) return "none";
  const isBr = (c: EditableChildLike) =>
    c.nodeType === NODE_TYPE_ELEMENT && c.tagName === "BR";
  const isText = (c: EditableChildLike) => c.nodeType === NODE_TYPE_TEXT;
  const allTextOrBr = children.every((c) => isText(c) || isBr(c));
  const hasBr = children.some(isBr);
  if (allTextOrBr && hasBr) return "multi-existing-br";
  if (children.length === 1 && isText(children[0]!)) {
    const text = children[0]!.textContent ?? "";
    if (text.trim().length === 0) return "single";
    return "multi-promote-text";
  }
  return "single";
}

export function captureEditable(el: Element): EditableHandle | null {
  const children = Array.from(el.childNodes);
  const mode = classifyEditableChildren(children);
  if (mode === "multi-existing-br") {
    const nodes = children as Array<Text | HTMLBRElement>;
    const originalChildren = children.map((n) => n.cloneNode(true));
    return { kind: "multi", parent: el, nodes, originalChildren };
  }
  if (mode === "multi-promote-text") {
    const node = children[0] as Text;
    return {
      kind: "multi",
      parent: el,
      nodes: [node],
      originalChildren: [node.cloneNode(true)],
    };
  }
  if (mode === "none") return null;
  const hasElementChild = children.some((c) => c.nodeType === NODE_TYPE_ELEMENT);
  if (hasElementChild) {
    const fullText = el.textContent?.trim() ?? "";
    if (fullText) {
      const originalChildren = children.map((n) => n.cloneNode(true));
      return { kind: "flat", el, originalChildren };
    }
    return null;
  }
  const node = findEditableTextNode(el);
  return node ? { kind: "single", node } : null;
}

export function readEditableText(handle: EditableHandle): string {
  if (handle.kind === "single") return handle.node.textContent ?? "";
  if (handle.kind === "flat") return handle.el.textContent ?? "";
  return handle.nodes
    .map((n) =>
      n.nodeType === Node.TEXT_NODE ? ((n as Text).textContent ?? "") : "\n",
    )
    .join("");
}

export function writeEditableText(handle: EditableHandle, text: string): void {
  if (handle.kind === "single") {
    handle.node.textContent = text;
    return;
  }
  if (handle.kind === "flat") {
    handle.el.textContent = text;
    return;
  }
  const doc = handle.parent.ownerDocument ?? document;
  const tokens = tokenizeEditableText(text);
  const newNodes: Array<Text | HTMLBRElement> = tokens.map((tok) =>
    tok.kind === "br" ? doc.createElement("br") : doc.createTextNode(tok.value),
  );
  handle.parent.replaceChildren(...newNodes);
  handle.nodes = newNodes;
}

export function restoreEditable(handle: EditableHandle, originalText: string): void {
  if (handle.kind === "single") {
    handle.node.textContent = originalText;
    return;
  }
  if (handle.kind === "flat") {
    const clones = handle.originalChildren.map((n) => n.cloneNode(true));
    handle.el.replaceChildren(...clones);
    return;
  }
  const clones = handle.originalChildren.map((n) => n.cloneNode(true));
  handle.parent.replaceChildren(...clones);
  handle.nodes = clones as Array<Text | HTMLBRElement>;
}

// flat/multi 복원은 cloneNode로 자식을 통째 교체해 페이지가 건 이벤트 리스너를 잃는다.
// 텍스트가 실제로 바뀐 경우에만 복원해 미편집 picking→취소 시 리스너를 보존한다.
export function shouldRestoreEditable(
  handle: EditableHandle,
  originalText: string | null,
): boolean {
  return originalText !== null && readEditableText(handle) !== originalText;
}

/* ── internal ────────────────────────────────────── */

function allStyleSheets(): readonly CSSStyleSheet[] {
  const regular = Array.from(document.styleSheets) as CSSStyleSheet[];
  const adopted = document.adoptedStyleSheets
    ? Array.from(document.adoptedStyleSheets)
    : [];
  return [...regular, ...adopted];
}

function collectRulesForElement(
  el: Element,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  wantedProps?: Set<string>,
): void {
  const matched = getMatchingRules(el);
  for (const rule of matched) {
    const decl = rule.style;
    const ruleSelector = rule.selectorText;
    const raw = getRawDeclarationsFor(rule);
    if (raw) {
      extractVarPropsFromMap(raw, out, sources, customProps, ruleSelector, wantedProps);
    } else {
      extractVarPropsFromCssText(decl.cssText, out, sources, customProps, ruleSelector, wantedProps);
    }
    for (let i = 0; i < decl.length; i++) {
      const name = decl.item(i);
      const val = decl.getPropertyValue(name);
      if (!val) continue;
      if (name.startsWith("--")) {
        if (!customProps[name]) customProps[name] = val.trim();
        continue;
      }
      if (wantedProps && !wantedProps.has(name)) continue;
      if (!(out[name]?.includes("var(") && !val.includes("var("))) {
        out[name] = val;
        sources[name] = ruleSelector;
      }
    }
    for (const shorthand of Object.keys(SHORTHAND_MAP)) {
      if (wantedProps && !wantedProps.has(shorthand)) continue;
      const val = decl.getPropertyValue(shorthand);
      if (val && !(out[shorthand]?.includes("var(") && !val.includes("var("))) {
        out[shorthand] = val;
        sources[shorthand] = ruleSelector;
      }
    }
  }
  if (el instanceof HTMLElement) {
    const style = el.style;
    extractVarPropsFromCssText(style.cssText, out, sources, customProps, "[inline]", wantedProps);
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      const val = style.getPropertyValue(name);
      if (!val) continue;
      if (name.startsWith("--")) {
        if (!customProps[name]) customProps[name] = val.trim();
        continue;
      }
      if (wantedProps && !wantedProps.has(name)) continue;
      if (!(out[name]?.includes("var(") && !val.includes("var("))) {
        out[name] = val;
        sources[name] = "[inline]";
      }
    }
    for (const shorthand of Object.keys(SHORTHAND_MAP)) {
      if (wantedProps && !wantedProps.has(shorthand)) continue;
      const val = style.getPropertyValue(shorthand);
      if (val && !(out[shorthand]?.includes("var(") && !val.includes("var("))) {
        out[shorthand] = val;
        sources[shorthand] = "[inline]";
      }
    }
  }
  // cross-origin author 규칙은 same-origin·inline이 채운 뒤 빈 prop만 보강한다.
  mergeCrossOriginDecls(
    out,
    sources,
    customProps,
    getMatchingCrossOriginRules(el),
    getCrossOriginCustomProps(),
    wantedProps,
  );
}

// 순수: same-origin이 이미 채운 prop은 보존하고(빈 prop만 채움), cross-origin 규칙끼리는
// seq 큰 게 override. --*는 customProps에 보충(없는 키만). var() 해석은 호출부에서 별도.
export function mergeCrossOriginDecls(
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  rules: CrossOriginRule[],
  crossCustomProps: Record<string, string>,
  wantedProps?: Set<string>,
): void {
  const sameOriginKeys = new Set(Object.keys(out));
  // same-origin shorthand(padding 등)이 점유한 longhand도 claimed 처리 — 아직 안 펼쳐진
  // shorthand를 cross-origin longhand가 우회해 덮어쓰는 split(same-origin wins 위반) 방지.
  for (const key of [...sameOriginKeys]) {
    const longhands = SHORTHAND_MAP[key];
    if (longhands) for (const lh of longhands) sameOriginKeys.add(lh);
    // border/border-{side}는 SHORTHAND_MAP 밖(width|style|color 혼합)이라 별도 claim —
    // same-origin border가 cross-origin border-{side}-color에 split당하는 것 방지.
    const sides = BORDER_SHORTHAND_SIDES[key];
    if (sides)
      for (const side of sides)
        for (const prop of ["width", "style", "color"])
          sameOriginKeys.add(`border-${side}-${prop}`);
  }
  for (const rule of rules) {
    for (const [name, val] of rule.decls) {
      if (!val) continue;
      if (name.startsWith("--")) {
        if (!customProps[name]) customProps[name] = val.trim();
        continue;
      }
      if (wantedProps && !wantedProps.has(name)) continue;
      if (sameOriginKeys.has(name)) continue;
      // same-origin 경로와 동일: 이미 잡은 var(토큰)을 나중 cross-origin literal이 덮지
      // 않게 보존 — 한 prop이 여러 규칙에서 재선언될 때(예: <a> color) 토큰이 computed로
      // 강등되는 것 방지. literal→var, var→var는 통과(last-wins).
      if (out[name]?.includes("var(") && !val.includes("var(")) continue;
      out[name] = val;
      sources[name] = rule.selectorText;
    }
  }
  for (const name in crossCustomProps) {
    if (!customProps[name]) customProps[name] = crossCustomProps[name];
  }
}

function extractVarPropsFromCssText(
  cssText: string,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  origin: string,
  wantedProps?: Set<string>,
): void {
  const declared = new Map<string, string>();
  CSS_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_DECL_RE.exec(cssText)) !== null) {
    declared.set(m[1], m[2].replace(/\s*!\s*important\s*$/i, "").trim());
  }
  extractVarPropsFromMap(declared, out, sources, customProps, origin, wantedProps);
}

function extractVarPropsFromMap(
  declared: Map<string, string>,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  origin: string,
  wantedProps?: Set<string>,
): void {
  for (const [prop, val] of declared) {
    if (prop.startsWith("--")) {
      if (!customProps[prop]) customProps[prop] = val;
      continue;
    }
    if (wantedProps && !wantedProps.has(prop)) continue;
    if (!val.includes("var(")) continue;
    if (!out[prop] || !out[prop].includes("var(")) {
      out[prop] = val;
      sources[prop] = origin;
    }
    const longhands = SHORTHAND_MAP[prop];
    if (!longhands) continue;
    const trbl = TRBL_SHORTHANDS[prop];
    const split = trbl ? splitTrblValue(val) : null;
    for (let j = 0; j < longhands.length; j++) {
      const lh = longhands[j];
      if (declared.has(lh)) continue;
      const lhVal = split ? split[j] : val;
      if (!out[lh] || !out[lh].includes("var(")) {
        out[lh] = lhVal;
        sources[lh] = origin;
      }
    }
  }
}

export function expandShorthands(
  all: Record<string, string>,
  sources: Record<string, string>,
): void {
  for (const [shorthand, longhands] of Object.entries(SHORTHAND_MAP)) {
    if (!(shorthand in all)) continue;
    const value = all[shorthand];
    const origin = sources[shorthand];
    const trbl = TRBL_SHORTHANDS[shorthand];
    const split = trbl ? splitTrblValue(value) : null;
    if (split) {
      for (let i = 0; i < trbl.length; i++) {
        const lh = trbl[i];
        if (!(lh in all)) {
          all[lh] = split[i];
          if (origin) sources[lh] = origin;
        }
      }
      continue;
    }
    for (const lh of longhands) {
      if (!(lh in all)) {
        all[lh] = value;
        if (origin) sources[lh] = origin;
      }
    }
  }
  // border / border-{side} shorthand는 width|style|color 혼합이라 TRBL split이 아니라
  // 토큰 분류로 변별 longhand에 분배 — `border: 1px solid var(--c)`의 color 토큰을 살린다.
  for (const [shorthand, sides] of Object.entries(BORDER_SHORTHAND_SIDES)) {
    if (!(shorthand in all)) continue;
    const parts = parseBorderShorthand(all[shorthand]);
    const origin = sources[shorthand];
    for (const side of sides) {
      fillIfAbsent(all, sources, `border-${side}-width`, parts.width, origin);
      fillIfAbsent(all, sources, `border-${side}-style`, parts.style, origin);
      fillIfAbsent(all, sources, `border-${side}-color`, parts.color, origin);
    }
  }
}

function fillIfAbsent(
  all: Record<string, string>,
  sources: Record<string, string>,
  prop: string,
  value: string | undefined,
  origin: string | undefined,
): void {
  if (value === undefined || prop in all) return;
  all[prop] = value;
  if (origin) sources[prop] = origin;
}

function isBorderWidthToken(tok: string): boolean {
  if (tok === "thin" || tok === "medium" || tok === "thick") return true;
  if (BORDER_WIDTH_NUM_RE.test(tok)) return true;
  return /^(calc|clamp|min|max)\(/i.test(tok);
}

// border shorthand 값을 width|style|color로 분류. 모호한 토큰(var()·함수형·named)은 color로
// 떨어뜨려 테마 색 토큰을 살린다(실무에서 border var는 거의 색).
export function parseBorderShorthand(value: string): {
  width?: string;
  style?: string;
  color?: string;
} {
  const out: { width?: string; style?: string; color?: string } = {};
  for (const tok of splitCssTokens(value.trim())) {
    if (!tok) continue;
    const lower = tok.toLowerCase();
    if (BORDER_STYLE_KEYWORDS.has(lower)) {
      out.style ??= tok;
    } else if (isBorderWidthToken(lower)) {
      out.width ??= tok;
    } else {
      out.color ??= tok;
    }
  }
  return out;
}

export function splitTrblValue(
  value: string,
): [string, string, string, string] | null {
  if (value.includes("/")) return null;
  const parts = splitCssTokens(value);
  if (parts.length === 0 || parts.length > 4) return null;
  const [a, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}

export function splitCssTokens(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === " " && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// 괄호 균형으로 top-level var() 참조를 스캔(중첩 fallback의 nested ) 보존). 각 참조를
// replace(name, fallback, match)로 위임하고 반환값으로 치환한다.
function replaceVarRefs(
  value: string,
  replace: (name: string, fallback: string | null, match: string) => string,
): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const idx = value.indexOf("var(", i);
    if (idx < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, idx);
    let depth = 0;
    let j = idx;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= value.length) {
      out += value.slice(idx);
      break;
    }
    const inner = value.slice(idx + 4, j);
    const comma = topLevelComma(inner);
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    out += replace(name, fallback, value.slice(idx, j + 1));
    i = j + 1;
  }
  return out;
}

function topLevelComma(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

export function resolveVarChain(
  value: string,
  customProps: Record<string, string>,
  depth = 0,
  chain?: Set<string>,
): string {
  if (depth > 5 || !value.includes("var(")) return value;
  let changed = false;
  const next = replaceVarRefs(value, (name, fallback, match) => {
    let resolvedName = name;
    let replacement = customProps[name];
    if (replacement === undefined && fallback) {
      const fb = SIMPLE_VAR_FALLBACK_RE.exec(fallback);
      if (fb && customProps[fb[1]] !== undefined) {
        resolvedName = fb[1];
        replacement = customProps[fb[1]];
      }
    }
    if (replacement === undefined) return match;
    // public 토큰은 보존(처음 이름에서 멈춤), private(--_)만 끝까지 펼침.
    if (!resolvedName.startsWith("--_")) return match;
    // chain은 현재 해석 경로 — 같은 이름이 자기 펼침에서 재등장하면 사이클로 멈춘다.
    // 같은 값 내 sibling 반복(var(--_x) var(--_x))은 chain이 분기별 복제라 각자 펼쳐진다.
    const seen = chain ?? new Set<string>();
    if (seen.has(resolvedName)) return match;
    changed = true;
    const nextChain = new Set(seen);
    nextChain.add(resolvedName);
    return resolveVarChain(replacement, customProps, depth + 1, nextChain);
  });
  return changed ? next : value;
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

// cross-origin :root/html/* custom props를 토큰 후보로 보충. same-origin·inline 수집
// 뒤에 호출해 빈칸만 채운다(!seen.has) — same-origin이 우선. cross-origin sheet는 CSSOM
// 열거가 막혀 collectFromRules가 못 잡으므로, 이게 빠지면 그 변수는 swatch가 누락된다.
export function mergeCrossOriginTokens(
  seen: Map<string, string>,
  crossProps: Record<string, string>,
): void {
  for (const [name, val] of Object.entries(crossProps)) {
    if (name.startsWith("--") && !seen.has(name)) seen.set(name, val);
  }
}

// 요소가 specified 값에서 실제 참조하는 var() 이름을 빈 값으로 등록. 정의가 cross-origin
// 스코프 셀렉터(:root 아님)에 있어 mergeCrossOriginTokens도 못 잡는 변수까지 커버 —
// 값은 collectTokens의 resolve 루프가 getComputedStyle로 채운다(출처·스코프 무관 해석).
export function collectReferencedTokenNames(
  styles: Record<string, string>,
  seen: Map<string, string>,
): void {
  for (const value of Object.values(styles)) {
    for (const m of value.matchAll(VAR_REF_RE)) {
      if (!seen.has(m[1])) seen.set(m[1], "");
    }
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

export function categorizeToken(value: string): TokenCategory {
  const v = value.trim();
  if (!v) return "unknown";
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return "color";
  if (/^(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\(/i.test(v))
    return "color";
  if (/^(transparent|currentColor)$/i.test(v)) return "color";
  if (NAMED_COLORS.has(v.toLowerCase())) return "color";
  if (/^(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|repeating-conic-gradient|url|image-set)\(/i.test(v))
    return "image";
  if (LENGTH_TOKEN_RE.test(v)) return "length";
  // unitless 0 / 길이 함수(calc·clamp·min·max에 길이 단위 포함)는 length 속성에서 유효 —
  // number로 떨어뜨리면 length prop 토큰 목록에서 누락된다.
  if (/^-?0(\.0+)?$/.test(v)) return "length";
  if (/^(calc|clamp|min|max)\(/i.test(v) && LENGTH_IN_FN_RE.test(v))
    return "length";
  if (/^-?\d*\.?\d+$/.test(v)) return "number";
  return "unknown";
}
