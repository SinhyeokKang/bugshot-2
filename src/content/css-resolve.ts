import type {
  PickerSelectionPayload,
  Token,
  TokenCategory,
} from "@/types/picker";
import {
  getCrossOriginCustomProps,
  getMatchingRules,
  getMatchingCrossOriginRules,
  getMatchingCrossOriginCustomPropRules,
  getRawDeclarationsFor,
  flattenSheets,
  splitSelectorList,
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
  // var()가 낀 transition은 CSSOM longhand가 전부 빈 문자열이라 shorthand로만 살아남는다.
  "transition",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "transition-delay",
  "table-layout",
  "border-collapse",
  "border-spacing",
  "caption-side",
  "empty-cells",
  "vertical-align",
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

// shorthand → 전개 대상 longhand. 값 분해 규칙은 아래 TRBL/PAIR 테이블이 정하고, 어느
// 쪽에도 없는 shorthand는 전개하지 않는다(`splitShorthandValue`). `font`처럼 문법이 가변인
// shorthand를 여기 등록하면 값이 longhand에 통째 복사돼 오염된다 — 누락이 오염보다 낫다.
const SHORTHAND_MAP: Record<string, string[]> = {
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
  // 물리 shorthand를 논리 짝보다 앞에 둔다 — 전개는 fill-if-absent라 순서가 곧 우선순위이고,
  // padding/margin이 이미 물리 우선이라 inset만 뒤집히면 축마다 규칙이 갈린다.
  inset: ["top", "right", "bottom", "left"],
  "inset-inline": ["left", "right"],
  "inset-block": ["top", "bottom"],
};

// 아래 두 집합은 **값을 몇 조각으로 쪼갤지**만 정한다. longhand 이름·순서의 단일 출처는
// SHORTHAND_MAP이다 — 이름을 여기 중복해 두면 두 곳이 갈릴 때 값이 조용히 뒤바뀐다.
const TRBL_SHORTHANDS = new Set([
  "inset",
  "padding",
  "margin",
  "border-radius",
  "border-width",
  "border-color",
  "border-style",
]);

// 2값 shorthand(1값이면 둘 다 같은 값). 논리 속성(inline/block)은 Chrome이 var() 유무와
// 무관하게 물리 longhand로 explode하지 않아 이 전개가 유일한 출처다. SHORTHAND_MAP의
// 논리→물리 매핑은 LTR 고정 — `direction: rtl`에선 좌우가 뒤집힌다.
const PAIR_SHORTHANDS = new Set([
  "gap",
  "overflow",
  "padding-inline",
  "padding-block",
  "margin-inline",
  "margin-block",
  "inset-inline",
  "inset-block",
]);

const BORDER_AXES = ["width", "style", "color"] as const;
type BorderAxis = (typeof BORDER_AXES)[number];

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
const VAR_NAME_RE = /^--[\w-]+$/;
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
  normalizePositionOffsets(computedStyles, specifiedStyles);
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
  const candidates: CustomPropCandidates = new Map();
  const uncertain = collectRulesForElement(el, all, sources, customProps, undefined, false, candidates);
  expandShorthands(all, sources);

  const missing = [...INHERITED_PROPS].filter((p) => !(p in all));
  if (missing.length > 0) {
    let cur = el.parentElement;
    while (cur && missing.length > 0) {
      const parentAll: Record<string, string> = {};
      const parentSources: Record<string, string> = {};
      const parentUncertain = collectRulesForElement(
        cur,
        parentAll,
        parentSources,
        customProps,
        undefined,
        false,
        candidates,
      );
      expandShorthands(parentAll, parentSources);
      for (let i = missing.length - 1; i >= 0; i--) {
        const p = missing[i];
        if (p in parentAll) {
          if (parentUncertain.has(p)) {
            // 이 조상에서 실제 winner를 확정할 수 없으면 더 먼 조상을 찾지 않는다.
            // 선택 요소의 computed 값이 상속 결과의 단일 출처다.
            uncertain.add(p);
            missing.splice(i, 1);
            continue;
          }
          all[p] = parentAll[p];
          if (parentSources[p]) sources[p] = `${parentSources[p]} ↑`;
          missing.splice(i, 1);
        }
      }
      cur = cur.parentElement;
    }
  }

  finalizeCustomProps(el, Object.values(all), window.getComputedStyle(el), customProps, candidates);

  for (const prop of Object.keys(all)) {
    all[prop] = resolveVarChain(all[prop], customProps);
  }
  const uncertainComputed = window.getComputedStyle(el);
  resolveUncertainSpecified(all, sources, uncertain, (prop) =>
    uncertainComputed.getPropertyValue(prop).trim(),
  );

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
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "letter-spacing",
]);

export function collectInspectorSpecRefs(
  el: Element,
  computed?: Pick<CSSStyleDeclaration, "getPropertyValue">,
): InspectorSpecRefs {
  const all: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const customProps: Record<string, string> = {};
  const candidates: CustomPropCandidates = new Map();
  collectRulesForElement(el, all, sources, customProps, INSPECTOR_WANTED, false, candidates);
  expandShorthands(all, sources);

  const missing = INSPECTOR_INHERITED.filter((p) => !(p in all));
  if (missing.length > 0) {
    let cur = el.parentElement;
    while (cur && missing.length > 0) {
      const parentAll: Record<string, string> = {};
      const parentSources: Record<string, string> = {};
      collectRulesForElement(cur, parentAll, parentSources, customProps, INSPECTOR_WANTED, false, candidates);
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

  // 편집/CSS 뷰(collectSpecifiedStylesWithSources)와 **같은** 전처리를 태운다 — 갈리면 같은
  // 요소의 툴팁과 편집 탭이 서로 다른 토큰 이름을 보여준다(POSTMORTEM 2026-08-01).
  finalizeCustomProps(
    el,
    Object.values(all),
    computed ?? window.getComputedStyle(el),
    customProps,
    candidates,
  );

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
  // 1패스: computed 우선(출처·스코프 무관 해석) → 없으면 원문. 2패스에서 이 맵으로
  // 남은 var() 체인을 값까지 편다 — 스코프 밖 정의라 computed가 비는 토큰이 alias면
  // 값이 var(…)로 남아 category=unknown이 되기 때문.
  const resolvedProps: Record<string, string> = {};
  for (const [name, raw] of seen) {
    let resolved = (elStyle || rootStyle).getPropertyValue(name).trim() || raw;
    if (resolved.startsWith("var(")) {
      resolved = rootStyle.getPropertyValue(name).trim() || raw;
    }
    resolvedProps[name] = resolved;
  }
  const tokens: Token[] = [];
  for (const [name, resolved] of Object.entries(resolvedProps)) {
    const value = resolveTokenValue(resolved, resolvedProps, 0, new Set([name]));
    tokens.push({ name, value, category: categorizeToken(value) });
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

export function collectInspectorInfo(el: Element): InspectorInfo {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  const tag = el.tagName.toLowerCase();
  const allClasses = Array.from(el.classList);
  const classes = allClasses.slice(0, 3);
  const classOverflow = Math.max(0, allClasses.length - 3);

  const refs = collectInspectorSpecRefs(el, cs);

  const colorValue = formatColor(cs.color) ?? cs.color;
  const color = firstVarName(refs.color) ?? colorValue;

  const bgValue = formatColor(cs.backgroundColor);
  const backgroundColor = bgValue
    ? (firstVarName(refs.backgroundColor) ?? bgValue)
    : undefined;
  const backgroundColorValue = bgValue;

  const family = parseFirstFontFamily(cs.fontFamily);
  const fontSize = firstVarName(refs.fontSize) ?? cs.fontSize;
  const fontWeight = firstVarName(refs.fontWeight) ?? cs.fontWeight;

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
    ),
  };
}

function resolveBoxLabel(
  refs: [string?, string?, string?, string?],
  computed: [string, string, string, string],
): string | undefined {
  if (computed.every((v) => parseFloat(v) === 0)) return undefined;
  const labels: [string, string, string, string] = [
    firstVarName(refs[0]) ?? computed[0],
    firstVarName(refs[1]) ?? computed[1],
    firstVarName(refs[2]) ?? computed[2],
    firstVarName(refs[3]) ?? computed[3],
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

// 시트 열거 단일 출처(`flattenSheets`) — @import 하강까지 css-source-cache의 rule index와
// 같은 경계를 쓴다. 갈리면 제안엔 뜨는데 specified엔 안 잡히는 비대칭이 생긴다.
function allStyleSheets(): readonly CSSStyleSheet[] {
  const regular = Array.from(document.styleSheets) as CSSStyleSheet[];
  const adopted = document.adoptedStyleSheets
    ? Array.from(document.adoptedStyleSheets)
    : [];
  return flattenSheets([...regular, ...adopted]);
}

function collectRulesForElement(
  el: Element,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  wantedProps?: Set<string>,
  customPropsOnly = false,
  candidates: CustomPropCandidates = new Map(),
): Set<string> {
  const claims = newClaimState();
  // custom property 충돌은 **한 스코프(요소)에 매칭된 규칙들 사이**의 개념이다. 규칙 단위로
  // 모았다가 스코프로 올려야 ① 같은 규칙을 raw 파서와 CSSOM이 각각 읽는 걸 자기 충돌로 세지
  // 않고 ② 가까운 조상이 먼 조상을 가리는 정상 섀도잉을 충돌로 오인하지 않는다.
  const scopeProps: Record<string, string> = {};
  const matched = getMatchingRules(el);
  for (const rule of matched) {
    const decl = rule.style;
    const ruleSelector = rule.selectorText;
    // customPropsOnly 경로(조상 custom prop 순회)는 일반 prop이 전부 필터 탈락해
    // noteClaim 도달 선언이 0개 — 계산이 사장되므로 건너뛴다.
    const spec =
      customPropsOnly || hasOpaqueCascadeContext(rule)
        ? null
        : matchedSpecificity(el, ruleSelector);
    const raw = getRawDeclarationsFor(rule);
    const ruleProps: Record<string, string> = {};
    // raw 파서는 `!important`를 값에서 벗겨내므로 이 규칙 자신의 중요도는 CSSOM에서만
    // 읽을 수 있다. 이게 없으면 나중 규칙의 `!important` shorthand가 앞선 것에 진다.
    const selfImportant = importantProps(decl);
    if (raw) {
      extractVarPropsFromMap(raw, out, sources, ruleProps, ruleSelector, wantedProps, claims, selfImportant, spec);
    } else {
      extractVarPropsFromCssText(decl.cssText, out, sources, ruleProps, ruleSelector, wantedProps, claims, selfImportant, spec);
    }
    applyDeclarations(decl, out, sources, ruleProps, ruleSelector, wantedProps, claims, spec);
    mergeIntoScope(scopeProps, candidates, ruleProps);
  }
  if (el instanceof HTMLElement) {
    const style = el.style;
    const inlineProps: Record<string, string> = {};
    extractVarPropsFromCssText(style.cssText, out, sources, inlineProps, "[inline]", wantedProps, claims, importantProps(style));
    applyDeclarations(style, out, sources, inlineProps, "[inline]", wantedProps, claims);
    mergeIntoScope(scopeProps, candidates, inlineProps);
  }
  // cross-origin author 규칙은 same-origin·inline이 채운 뒤 빈 prop만 보강한다.
  const crossProps: Record<string, string> = {};
  mergeCrossOriginDecls(
    out,
    sources,
    crossProps,
    customPropsOnly
      ? getMatchingCrossOriginCustomPropRules(el)
      : getMatchingCrossOriginRules(el),
    getCrossOriginCustomProps(),
    wantedProps,
  );
  mergeIntoScope(scopeProps, candidates, crossProps);
  gapFill(customProps, scopeProps);
  return claims.uncertain;
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
    if (Array.isArray(sides))
      for (const side of sides)
        for (const axis of BORDER_AXES) sameOriginKeys.add(`border-${side}-${axis}`);
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
      // same-origin 경로와 **같은 판정 함수**를 쓴다 — 가드를 손으로 복제하면 한쪽만
      // 고쳐져 드리프트한다(docs/POSTMORTEM.md 2026-06-28). cross-origin은 gap-fill이라
      // 파생·중요도 축이 없으므로 기본값으로 호출한다.
      if (!shouldOverwriteSpecified(out[name], val, false)) continue;
      out[name] = val;
      sources[name] = rule.selectorText;
    }
  }
  for (const name in crossCustomProps) {
    if (!customProps[name]) customProps[name] = crossCustomProps[name];
  }
}

// CSSOM 선언 블록(매치된 규칙 또는 inline)을 specified에 반영. 규칙과 inline이 같은 규율을
//쓰도록 한 곳에 모은다 — `!important`는 CSSOM에서만 읽을 수 있고(raw 파서는 값에서 벗겨낸다),
// var()가 낀 shorthand의 pending longhand에서도 priority는 정확히 나온다.
function applyDeclarations(
  decl: CSSStyleDeclaration,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  origin: string,
  wantedProps: Set<string> | undefined,
  claims: ClaimState,
  specificity: Specificity | null = null,
): void {
  for (let i = 0; i < decl.length; i++) {
    const name = decl.item(i);
    const val = decl.getPropertyValue(name);
    const important = decl.getPropertyPriority(name) === "important";
    if (!val) {
      // var()가 낀 shorthand의 longhand는 값이 비어도 priority는 정확히 나온다 —
      // 여기서 기록해 두지 않으면 그 규칙의 중요도를 영영 알 수 없다.
      if (important) claims.important.add(name);
      continue;
    }
    if (name.startsWith("--")) {
      if (!customProps[name]) customProps[name] = val.trim();
      continue;
    }
    if (wantedProps && !wantedProps.has(name)) continue;
    if (
      noteClaim(claims, name, val, important, origin, specificity) &&
      shouldOverwriteSpecified(
        out[name],
        val,
        claims.derived.has(name),
        claims.important.has(name),
        important,
      )
    ) {
      out[name] = val;
      sources[name] = origin;
      claims.derived.delete(name);
    }
    // 중요도 부기는 verdict 게이트 밖 — 게이트 안으로 들어가면 후속 중요도 판정이 무너진다.
    if (important) claims.important.add(name);
  }
  for (const shorthand of Object.keys(SHORTHAND_MAP)) {
    if (wantedProps && !wantedProps.has(shorthand)) continue;
    const val = decl.getPropertyValue(shorthand);
    const important = decl.getPropertyPriority(shorthand) === "important";
    if (!val) continue;
    if (
      noteClaim(claims, shorthand, val, important, origin, specificity) &&
      shouldOverwriteSpecified(
        out[shorthand],
        val,
        claims.derived.has(shorthand),
        claims.important.has(shorthand),
        important,
      )
    ) {
      out[shorthand] = val;
      sources[shorthand] = origin;
      claims.derived.delete(shorthand);
    }
    if (important) claims.important.add(shorthand);
  }
}

// 이 선언 블록이 !important로 선언한 prop. raw 파서는 `!important`를 값에서 벗겨내므로
// CSSOM이 유일한 출처다. item() 열거는 longhand만 주고 shorthand 키(`border-style`·
// `padding`)는 빠지므로 그것들은 이름으로 직접 조회한다 — 조회 자체는 값이 pending인
// var() shorthand에서도 priority를 정확히 돌려준다.
const IMPORTANT_SHORTHAND_KEYS = [
  ...Object.keys(SHORTHAND_MAP),
  ...Object.keys(BORDER_SHORTHAND_SIDES),
];

function importantProps(decl: CSSStyleDeclaration): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < decl.length; i++) {
    const name = decl.item(i);
    if (decl.getPropertyPriority(name) === "important") out.add(name);
  }
  for (const key of IMPORTANT_SHORTHAND_KEYS) {
    if (decl.getPropertyPriority(key) === "important") out.add(key);
  }
  return out;
}

function extractVarPropsFromCssText(
  cssText: string,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  origin: string,
  wantedProps?: Set<string>,
  claims?: ClaimState,
  selfImportant?: Set<string>,
  specificity: Specificity | null = null,
): void {
  const declared = new Map<string, string>();
  CSS_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_DECL_RE.exec(cssText)) !== null) {
    declared.set(m[1], m[2].replace(/\s*!\s*important\s*$/i, "").trim());
  }
  extractVarPropsFromMap(declared, out, sources, customProps, origin, wantedProps, claims, selfImportant, specificity);
}

export type Specificity = readonly [number, number, number];

// CSS는 성분별 사전식 비교이고 각 성분에 규격상 상한이 없다 — 스칼라 인코딩은 cap 충돌을 만든다.
export function compareSpecificity(a: Specificity, b: Specificity): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

const LEGACY_PSEUDO_ELEMENTS = new Set([
  "before",
  "after",
  "first-line",
  "first-letter",
]);

// 인자 중 최고 specificity가 가산되는 특례 — 정확 재현엔 중첩 파싱 + 매치 판정까지 필요하고,
// 잘못된 확정(패자 원문 표시)이 uncertain(computed 폴백)보다 해로우므로 보수적으로 null 처리.
// :host(-context)는 document 시트만 순회하는 현 구조상 실도달이 없지만 방어적으로 등재.
const UNRESOLVABLE_FUNCTIONAL_PSEUDOS = new Set([
  "is",
  "not",
  "has",
  "host",
  "host-context",
]);

const IDENT_CHAR_RE = /[a-zA-Z0-9_-]/;
const PSEUDO_NAME_CHAR_RE = /[a-zA-Z-]/;
const HEX_CHAR_RE = /[0-9a-fA-F]/;
const ESCAPE_TERMINATOR_RE = /[ \t\n\r\f]/;

// i는 `\` 위치. 이스케이프 시퀀스 끝 다음 인덱스를 돌려준다. hex 이스케이프는 최대 6자리
// **+ 종결 공백 1개**까지가 한 시퀀스다 — Chrome CSSOM이 숫자로 시작하는 클래스를 이 형태로
// 직렬화하므로(Tailwind `2xl:mt-4` → `.\32 xl\:mt-4`), 공백을 안 먹으면 뒤 ident가 별개
// type 셀렉터로 이중 카운트된다.
function skipEscape(s: string, i: number): number {
  let j = i + 1;
  if (j < s.length && HEX_CHAR_RE.test(s[j])) {
    const limit = Math.min(j + 6, s.length);
    while (j < limit && HEX_CHAR_RE.test(s[j])) j++;
    // CRLF는 whitespace 하나로 센다.
    if (s[j] === "\r" && s[j + 1] === "\n") return j + 2;
    if (ESCAPE_TERMINATOR_RE.test(s[j] ?? "")) j++;
    return j;
  }
  return j + 1;
}

function consumeIdent(s: string, i: number): number {
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i = skipEscape(s, i);
      continue;
    }
    if (IDENT_CHAR_RE.test(ch) || ch.charCodeAt(0) > 127) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

// i는 여는 괄호 위치. 닫는 짝 인덱스를 돌려주고 미폐합이면 -1.
function skipBalanced(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

// 단일 셀렉터(콤마 없음)의 specificity 튜플. 판정 불가면 null — 그 규칙의 충돌은
// 기존 uncertain 경로(computed 폴백)로 남는다.
export function selectorSpecificity(selector: string): Specificity | null {
  let a = 0;
  let b = 0;
  let c = 0;
  const s = selector;
  const len = s.length;
  let i = 0;
  while (i < len) {
    const ch = s[i];
    if (ch === "\\") {
      i = skipEscape(s, i);
      continue;
    }
    if (ch === "[") {
      const end = skipBalanced(s, i, "[", "]");
      if (end < 0) return null;
      b++;
      i = end + 1;
      continue;
    }
    if (ch === "#") {
      a++;
      i = consumeIdent(s, i + 1);
      continue;
    }
    if (ch === ".") {
      b++;
      i = consumeIdent(s, i + 1);
      continue;
    }
    // CSS nesting의 &는 :is(부모) 상당 — 인자 가산 특례와 같은 이유로 판정 불가.
    if (ch === "&") return null;
    // 최상위 |는 네임스페이스(ns|div) — 토크나이저가 type 2개로 오분류할 수 있어 보수 null.
    // [attr|=x]는 대괄호 스킵에 흡수되므로 여기 도달하지 않는다.
    if (ch === "|") return null;
    if (ch === ":") {
      const isElement = s[i + 1] === ":";
      let j = i + (isElement ? 2 : 1);
      const nameStart = j;
      while (j < len && PSEUDO_NAME_CHAR_RE.test(s[j])) j++;
      const name = s.slice(nameStart, j).toLowerCase();
      const functional = s[j] === "(";
      let argEnd = j;
      if (functional) {
        argEnd = skipBalanced(s, j, "(", ")");
        if (argEnd < 0) return null;
      }
      if (isElement) {
        // ::part()/::slotted()는 인자가 specificity에 가산되는 특례.
        if (name === "part" || name === "slotted") return null;
        c++;
      } else if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
        c++;
      } else if (name === "where") {
        // :where()는 0 기여.
      } else if (UNRESOLVABLE_FUNCTIONAL_PSEUDOS.has(name) && functional) {
        return null;
      } else if (
        (name === "nth-child" || name === "nth-last-child") &&
        functional &&
        /\bof\b/i.test(s.slice(j + 1, argEnd))
      ) {
        // `:nth-child(An+B of S)`는 S가 가산되는 특례.
        return null;
      } else {
        b++;
      }
      i = functional ? argEnd + 1 : j;
      continue;
    }
    if (
      ch === "*" ||
      ch === " " ||
      ch === "\t" ||
      ch === "\n" ||
      ch === ">" ||
      ch === "+" ||
      ch === "~" ||
      ch === ","
    ) {
      i++;
      continue;
    }
    c++;
    i = consumeIdent(s, i + 1);
  }
  return [a, b, c];
}

// selector list에서 el에 실제 매치되는 파트 중 최고 specificity(CSS 사양과 동일).
// el은 구조적 타입 — node 테스트에서 스텁 주입 가능.
export function matchedSpecificity(
  el: { matches(selectors: string): boolean },
  selectorText: string,
): Specificity | null {
  const parts = splitSelectorList(selectorText);
  let best: Specificity | null = null;
  for (const part of parts) {
    let matched: boolean;
    try {
      matched = el.matches(part);
    } catch {
      // 이 파트의 매치 여부를 모르면 그 파트가 승자인지도 알 수 없다.
      return null;
    }
    if (!matched) continue;
    const spec = selectorSpecificity(part);
    // 매치된 파트가 판정 불가면 그 파트가 최고일 수 있다.
    if (spec === null) return null;
    if (best === null || compareSpecificity(spec, best) > 0) best = spec;
  }
  return best;
}

// node/jsdom엔 CSS rule 전역이 없다 — typeof 가드 없이는 ReferenceError.
function instanceOfGlobal(value: unknown, ctorName: string): boolean {
  const ctor = (globalThis as Record<string, unknown>)[ctorName];
  return (
    typeof ctor === "function" &&
    value instanceof (ctor as abstract new (...args: never[]) => unknown)
  );
}

// 인덱서(`css-source-cache.ts:walkRulesForIndex`)가 조건을 **실제로 평가하고** 하강하는
// 그룹 규칙. 나머지(@layer·@scope·@container·@starting-style·미래 at-rule)는 조건 무관하게
// 인덱싱되거나 승부 축이 specificity 밖이라 승자를 확정할 수 없다.
const TRANSPARENT_GROUP_RULES = ["CSSMediaRule", "CSSSupportsRule"];

// 승자를 확정할 수 없는 캐스케이드 문맥 판정 — null spec으로 기존 uncertain 경로를 태운다.
// **열거가 아니라 화이트리스트다**: opaque 목록을 나열하면 "나머지는 안전하다"는 반대 전제가
// 생겨 다음 at-rule에서 같은 구멍이 재발한다(docs/POSTMORTEM.md 2026-07-31 "밀어낼 대상을
// 열거하지 않은 덮어쓰기" 재발 방지 (4)).
// 모르는 그룹 규칙의 기본값은 uncertain이어야 한다 — 잘못된 확정이 computed 폴백보다 해롭다.
export function hasOpaqueCascadeContext(rule: CSSStyleRule): boolean {
  for (let r: CSSRule | null = rule.parentRule; r; r = r.parentRule) {
    if (!TRANSPARENT_GROUP_RULES.some((name) => instanceOfGlobal(r, name))) {
      return true;
    }
  }
  for (let sheet: CSSStyleSheet | null = rule.parentStyleSheet; sheet; ) {
    const owner: CSSRule | null = sheet.ownerRule;
    if (!owner) break;
    // 익명 layer(`@import … layer;`)는 layerName이 ""라 != null로 잡는다.
    if (
      instanceOfGlobal(owner, "CSSImportRule") &&
      (owner as { layerName?: string | null }).layerName != null
    ) {
      return true;
    }
    sheet = owner.parentStyleSheet;
  }
  return false;
}

// 규칙 순회 전체에 걸쳐 누적되는 판정 재료. specified 맵은 값만 갖고 있어서, 그 값이
// !important로 확정된 것인지 shorthand에서 파생된 것인지 구분할 수 없다.
export interface ClaimState {
  important: Set<string>;
  derived: Set<string>;
  candidates: Map<
    string,
    {
      value: string;
      important: boolean;
      origin: string;
      specificity: Specificity | null;
    }
  >;
  uncertain: Set<string>;
}

export function newClaimState(): ClaimState {
  return {
    important: new Set(),
    derived: new Set(),
    candidates: new Map(),
    uncertain: new Set(),
  };
}

// specificity 판정 불가(null-spec) 충돌로 남은 prop은 브라우저가 계산한 값으로 회피한다.
// 단 author가 var() 토큰을 썼으면 이름을 유지한다 — computed는 토큰을 이미 해석해 버려서,
// 덮으면 토큰 칩·swatch가 사라지고(`collectReferencedTokenNames`가 이름을 못 모은다)
// CSS 뷰가 리터럴 덤프가 된다. 근사 두 개 중 "값이 덜 정확하다"를 택하고 "토큰을 잃는다"를
// 버린 것. 같은 규칙을 raw 파서와 CSSOM이 표기만 다르게 읽어 동일 값 경로를 빠져나가는
// 자기 충돌은, var 경로가 var() 값만 다루고 여기의 var() 스킵이 그 값을 안 덮으므로 실해 없다.
export function resolveUncertainSpecified(
  all: Record<string, string>,
  sources: Record<string, string>,
  uncertain: Set<string>,
  computedOf: (prop: string) => string,
): void {
  for (const prop of uncertain) {
    if (all[prop]?.includes("var(")) continue;
    const computed = computedOf(prop);
    if (computed) {
      all[prop] = computed;
      sources[prop] = "[computed]";
    } else {
      delete all[prop];
      delete sources[prop];
    }
  }
}

// 규칙 간 캐스케이드 승자 판정(important > inline > specificity > 문서순)과 verdict 반환.
// 표기 보호(var() 토큰 강등 방지 등)는 shouldOverwriteSpecified가 맡는다 — 승자 판정과
// 표기 보호를 한 함수가 겸하면 조용히 하나를 버린다(docs/POSTMORTEM.md 2026-08-01).
// 반환 false면 호출부가 out/sources 쓰기를 건너뛴다(패자 원문이 확정 표시되는 회귀 방지).
export function noteClaim(
  claims: ClaimState,
  property: string,
  value: string,
  important: boolean,
  origin: string,
  specificity: Specificity | null = null,
): boolean {
  const previous = claims.candidates.get(property);
  const next = { value, important, origin, specificity };
  if (!previous) {
    claims.candidates.set(property, next);
    return true;
  }
  if (previous.important && !important) return false;
  if (!previous.important && important) {
    // important는 candidates가 잊은 null-spec 패자까지 전부 이기므로 판정 불가 이력을 무효화한다.
    claims.candidates.set(property, next);
    claims.uncertain.delete(property);
    return true;
  }
  if (origin === "[inline]" && previous.origin !== "[inline]") {
    claims.candidates.set(property, next);
    claims.uncertain.delete(property);
    return true;
  }
  if (previous.origin === "[inline]" && origin !== "[inline]") return false;
  if (previous.specificity != null && specificity != null) {
    // 동률은 문서순 뒤 승 — 순회가 seq 오름차순임을 getMatchingRules가 보장한다.
    if (compareSpecificity(specificity, previous.specificity) >= 0) {
      claims.candidates.set(property, next);
      return true;
    }
    // uncertain은 지우지 않는다 — 앞선 null-spec 충돌의 판정 불가 이력은 유효하고,
    // candidates는 마지막 승자 1개만 기억하므로 지우면 이력을 잃는다.
    return false;
  }
  if (previous.value === value) {
    // 값 자체는 확정이라 uncertain을 늘리지 않되, 출처를 모른 채 뒤 선언을 승자로 단정하지 않는다.
    return false;
  }
  claims.candidates.set(property, next);
  claims.uncertain.add(property);
  return true;
}

// specified 자리를 덮을지 판정하는 단일 출처. !important는 specificity보다 상위라 일반
// 선언이 못 이기고, 같은 중요도끼리는 문서 순서상 뒤가 이긴다. author가 직접 쓴 var()
// 토큰은 뒤따르는 리터럴로부터 보호하되(토큰 강등 방지), shorthand에서 파생된 값은 뒤
// 규칙의 직접 선언에 자리를 내준다 — 파생값까지 보호하면 longhand override가 무시된다.
export function shouldOverwriteSpecified(
  current: string | undefined,
  next: string,
  derived: boolean,
  currentImportant = false,
  nextImportant = false,
): boolean {
  if (currentImportant && !nextImportant) return false;
  if (derived) return true;
  return !(current?.includes("var(") && !next.includes("var("));
}

// 규칙 순회 중에 호출되는 유일한 전개 지점이라 **소스 순서를 안다** — 여기서 채운 longhand는
// 앞선 규칙(리셋 등)이 남긴 비-var 값을 덮는다. `expandShorthands`는 flat map이라 순서를
// 복원할 수 없어 fill-if-absent만 가능하다.
export function extractVarPropsFromMap(
  declared: Map<string, string>,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  origin: string,
  wantedProps?: Set<string>,
  claims?: ClaimState,
  selfImportant?: Set<string>,
  specificity: Specificity | null = null,
): void {
  for (const [prop, val] of declared) {
    if (prop.startsWith("--")) {
      if (!customProps[prop]) customProps[prop] = val.trim();
      continue;
    }
    if (wantedProps && !wantedProps.has(prop)) continue;
    if (!val.includes("var(")) continue;
    // 직접 선언 prop은 캐스케이드 승자 판정을 먼저 탄다(claims 없으면 통과). CSSOM 패스가
    // 같은 선언을 중복 등록해도 같은 값·origin·specificity라 동률 뒤 선언 분기로 무해하다.
    const winner = claims
      ? noteClaim(claims, prop, val, selfImportant?.has(prop) ?? false, origin, specificity)
      : true;
    if (winner && claimSpecified(out, sources, origin, prop, val, claims, selfImportant)) {
      // shorthand 키 자체는 author가 직접 쓴 값이라 파생이 아니다.
      claims?.derived.delete(prop);
    }
    // 패자 규칙의 파생 전개는 통째로 스킵 — 파생은 noteClaim을 안 타므로(후보 등록 시
    // 없던 uncertain이 새로 생긴다) 게이트 밖에 남기면 패자 파생값이 out을 덮는 desync가 된다.
    if (!winner) continue;
    // border/border-{side}는 width|style|color 혼합이라 SHORTHAND_MAP 밖 — 토큰 분류로 분해.
    const sides = BORDER_SHORTHAND_SIDES[prop];
    if (Array.isArray(sides)) {
      const parts = parseBorderShorthand(val);
      const later = declaredAfter(declared, prop);
      for (const axis of BORDER_AXES) {
        for (const side of sides) {
          claimBorderProp(later, out, sources, origin, side, axis, parts[axis], claims, selfImportant);
        }
        // `border`는 네 변을 한꺼번에 정하므로 4면 요약 키(`border-style` 등)도 갱신한다 —
        // 안 하면 앞선 리셋이 남긴 요약이 per-side longhand와 모순된 채 specified에 실린다.
        if (sides.length === 4) {
          claimBorderProp(later, out, sources, origin, null, axis, parts[axis], claims, selfImportant);
        }
      }
      continue;
    }
    const longhands = SHORTHAND_MAP[prop];
    if (!longhands) continue;
    const split = splitShorthandValue(prop, val, longhands);
    if (!split) continue;
    for (let j = 0; j < longhands.length; j++) {
      const lh = longhands[j];
      if (declared.has(lh)) continue;
      if (claimSpecified(out, sources, origin, lh, split[j], claims, selfImportant)) {
        claims?.derived.add(lh);
      }
    }
  }
}

// 같은 규칙에서 `prop` **뒤에** 선언된 속성 이름들. 같은 규칙 안에선 뒤가 이기므로, 앞에
// 선언된 축은 shorthand가 덮어야 한다 — has()만 보면 `border-color: #ddd; border: … var(--c)`
// 에서 이미 진 축에 양보해 토큰을 잃는다.
function declaredAfter(declared: Map<string, string>, prop: string): Set<string> {
  const keys = [...declared.keys()];
  return new Set(keys.slice(keys.indexOf(prop) + 1));
}

// side가 null이면 4면 요약 키(`border-color`), 아니면 변별 longhand(`border-top-color`).
// 뒤에 더 구체적으로 선언된 축이 있으면 양보하고, !important로 확정된 축과 이미 잡힌 var()
// 토큰은 보존한다(중요도 위반·토큰 강등 방지).
function claimBorderProp(
  later: Set<string>,
  out: Record<string, string>,
  sources: Record<string, string>,
  origin: string,
  side: string | null,
  axis: BorderAxis,
  value: string | undefined,
  claims?: ClaimState,
  selfImportant?: Set<string>,
): void {
  if (value === undefined) return;
  const prop = side ? `border-${side}-${axis}` : `border-${axis}`;
  if (later.has(prop) || later.has(`border-${axis}`)) return;
  if (side && later.has(`border-${side}`)) return;
  if (claimSpecified(out, sources, origin, prop, value, claims, selfImportant)) {
    claims?.derived.add(prop);
  }
}

// specified 한 자리를 이 규칙 값으로 claim. 덮었으면 true. 캐스케이드 판정은
// `shouldOverwriteSpecified` 하나가 내리고, 중요도 기록은 여기서 한 번에 한다 —
// 쓰기 경로마다 가드를 손으로 복제하면 한쪽만 고쳐져 드리프트한다.
function claimSpecified(
  out: Record<string, string>,
  sources: Record<string, string>,
  origin: string,
  prop: string,
  value: string,
  claims?: ClaimState,
  selfImportant?: Set<string>,
): boolean {
  const important = selfImportant?.has(prop) ?? false;
  if (
    !shouldOverwriteSpecified(
      out[prop],
      value,
      claims?.derived.has(prop) ?? false,
      claims?.important.has(prop) ?? false,
      important,
    )
  ) {
    return false;
  }
  out[prop] = value;
  sources[prop] = origin;
  if (important) claims?.important.add(prop);
  return true;
}

// getComputedStyle은 absolute/fixed 요소의 미지정 오프셋을 auto가 아니라 containing block
// 경계까지의 used px로 resolve한다. 작성자가 지정하지 않은 변(specified에 없음)은 cascaded
// 값(auto)으로 되돌려 편집 필드·diff가 used px를 실제 설정값처럼 노출하지 않게 한다.
export function normalizePositionOffsets(
  computedStyles: Record<string, string>,
  specifiedStyles: Record<string, string>,
): void {
  for (const p of ["top", "right", "bottom", "left"]) {
    if (!(p in specifiedStyles)) computedStyles[p] = "auto";
  }
}

// background shorthand은 색·이미지·위치·반복 등을 한 값에 담아, 값 전체를 background-color
// longhand로 복사하면 비색상 배경에서 specified가 오염된다. top-level 토큰이 하나이고
// 이미지 함수가 아닐 때만(단색/단일 var) background-color를 채운다.
function isBareBackgroundColor(value: string): boolean {
  const v = value.trim();
  let depth = 0;
  for (const ch of v) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === " " || ch === "\t" || ch === ",")) return false;
  }
  return categorizeToken(v) !== "image";
}

// shorthand 값 → longhands 각 자리의 값. 분해 규칙을 모르는 값(문법 가변·elliptical `/`·
// 토큰 과다)은 null을 돌려 전개를 포기시킨다 — 값을 통째 복사하면 longhand가 오염된다.
function splitShorthandValue(
  shorthand: string,
  value: string,
  longhands: string[],
): string[] | null {
  if (TRBL_SHORTHANDS.has(shorthand)) return splitTrblValue(value);
  if (PAIR_SHORTHANDS.has(shorthand)) return splitPairValue(value);
  if (shorthand === "background")
    return isBareBackgroundColor(value) ? longhands.map(() => value) : null;
  return null;
}

function splitPairValue(value: string): [string, string] | null {
  if (hasTopLevelSlash(value)) return null;
  const parts = splitCssTokens(value);
  if (parts.length === 0 || parts.length > 2) return null;
  const [a, b = a] = parts;
  return [a, b];
}

// `/`는 elliptical radius처럼 값을 두 벌로 가르는 구분자일 때만 전개를 막아야 한다 —
// `calc(100% / 3)`의 나눗셈까지 막으면 author 값이 통째로 사라지고 computed로 폴백한다.
function hasTopLevelSlash(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "/" && depth === 0) return true;
  }
  return false;
}

export function expandShorthands(
  all: Record<string, string>,
  sources: Record<string, string>,
): void {
  for (const [shorthand, longhands] of Object.entries(SHORTHAND_MAP)) {
    if (!(shorthand in all)) continue;
    const value = all[shorthand];
    const origin = sources[shorthand];
    const split = splitShorthandValue(shorthand, value, longhands);
    if (!split) continue;
    for (let i = 0; i < longhands.length; i++) {
      const lh = longhands[i];
      if (!(lh in all)) {
        all[lh] = split[i];
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

const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

function isUnassignableBorderToken(tok: string): boolean {
  const lower = tok.toLowerCase();
  return CSS_WIDE_KEYWORDS.has(lower) || lower.startsWith("var(");
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
  const tokens = splitCssTokens(value.trim());
  // 축을 특정할 수 없는 단일 토큰(`border: var(--bd)` — 토큰이 shorthand 전체를 담을 수
  // 있다, `border: inherit`)은 배정을 포기한다. color로 떨어뜨리면 색 슬롯에 `1px solid
  // #eee` 같은 값이 들어가 앞선 규칙의 올바른 축까지 덮는다. 대가로 그 입력에선 리셋 값이
  // 남지만, 누락이 오염보다 낫다.
  if (tokens.length === 1 && isUnassignableBorderToken(tokens[0])) return out;
  for (const tok of tokens) {
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
  if (hasTopLevelSlash(value)) return null;
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

// 값 전체가 var() 참조 하나뿐이면 그 이름·fallback을 돌려준다. 정규식(`[^)]*`)은 닫는 괄호를
// 못 먹어 `var(--a, var(--b, var(--c)))` 같은 2단 이상 중첩에서 조용히 매치 실패했다 —
// 괄호 깊이를 세는 스캔으로 바꿔 중첩 깊이에 무관하게 동작한다.
function parseSoleVarRef(
  value: string,
): { name: string; fallback: string | null } | null {
  const s = value.trim();
  if (!s.startsWith("var(")) return null;
  let depth = 0;
  for (let i = 3; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth > 0) continue;
      if (i !== s.length - 1) return null; // var() 뒤에 뭔가 더 있으면 단일 참조가 아니다.
      const inner = s.slice(4, i);
      const comma = topLevelComma(inner);
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      if (!VAR_NAME_RE.test(name)) return null;
      return { name, fallback: comma < 0 ? null : inner.slice(comma + 1).trim() };
    }
  }
  return null;
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
    // primary가 미정의면 fallback 체인을 따라 내려가며 실제로 값을 가진 이름을 찾는다.
    // depth 캡은 resolveVarChain과 같은 정신 — 병적인 중첩에서 멈춘다.
    for (let fb = replacement === undefined && fallback ? parseSoleVarRef(fallback) : null, hops = 0;
         fb && hops < 10;
         fb = fb.fallback ? parseSoleVarRef(fb.fallback) : null, hops++) {
      const v = customProps[fb.name];
      if (v !== undefined) {
        resolvedName = fb.name;
        replacement = v;
        break;
      }
    }
    if (replacement === undefined) return match;
    // public 토큰은 이름으로 보존한다. 단 fallback으로 넘어갔다면 **실효 토큰의 이름**으로
    // 좁힌다 — 원문을 그대로 두면 소비처(firstVarName·extractTokenRefs)가 값이 없는 primary를
    // 디자인 토큰으로 표시한다. 대가로 specified 표기에서 죽은 primary가 사라진다.
    if (!resolvedName.startsWith("--_")) {
      if (resolvedName === name) return match;
      changed = true;
      return `var(${resolvedName})`;
    }
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

// 토큰 목록의 값·category 판정용 완전 해석. resolveVarChain과 갈리는 지점은 하나 —
// public 토큰 이름도 펼친다. 이름 보존은 specified **표기**의 규칙이고, 여기서 필요한 건
// 실제 값이다(`--color-primary: var(--blue-500)`이 var(…)로 남으면 category=unknown이 돼
// ValueCombobox·CodeMirror의 base/extra에서 통째로 빠진다).
export function resolveTokenValue(
  value: string,
  props: Record<string, string>,
  depth = 0,
  chain?: Set<string>,
): string {
  if (depth > 5 || !value.includes("var(")) return value;
  const seen = chain ?? new Set<string>();
  return replaceVarRefs(value, (name, fallback, match) => {
    const replacement = props[name];
    if (replacement === undefined) {
      return fallback ? resolveTokenValue(fallback, props, depth + 1, seen) : match;
    }
    if (seen.has(name)) return match;
    const next = new Set(seen);
    next.add(name);
    return resolveTokenValue(replacement, props, depth + 1, next);
  });
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

export function hydrateReferencedCustomProps(
  values: string[],
  computed: Pick<CSSStyleDeclaration, "getPropertyValue">,
  customProps: Record<string, string>,
  candidates: CustomPropCandidates = new Map(),
): void {
  const queue = [...values];
  const seen = new Set<string>();
  // 캡은 초기 값 개수와 분리한다 — 합쳐 세면 prop이 많은 페이지에서 큐에 실은 참조가
  // 한 번도 처리되지 않고 굶는다(그 이름은 검증 안 된 수집 raw로 펼쳐진다).
  const limit = values.length + 100;
  for (let i = 0; i < queue.length && i < limit; i++) {
    for (const name of varRefNames(queue[i])) {
      if (seen.has(name)) continue;
      seen.add(name);
      const effective = computed.getPropertyValue(name).trim();
      if (!effective) continue;
      // computed는 캐스케이드 승자지만 Chrome이 custom property를 **완전 치환**해 주므로
      // 그대로 덮으면 토큰 이름이 사라진다(`--_text: var(--color-x)` → `#fff`). 수집한 원문이
      // 같은 값으로 풀리면 그 원문이 곧 승자이므로 이름을 남긴다 — 다르면(=stale raw) 덮는다.
      // 후보가 여럿이면 승자와 일치하는 것이 **하나뿐일 때만** 그 원문을 쓴다 — 둘 이상이
      // 일치하면 어느 선언이 이겼는지 판별할 수 없으므로 이름을 포기한다.
      const pool = candidates.get(name);
      const raws = pool ? [...pool] : [customProps[name]];
      const matches = raws.filter((raw) => {
        if (raw === undefined || !raw.includes("var(")) return false;
        const substituted = substituteFromComputed(raw, computed);
        return substituted !== null && sameResolvedValue(substituted, effective);
      });
      if (matches.length === 1) {
        customProps[name] = matches[0];
        queue.push(matches[0]);
        continue;
      }
      customProps[name] = effective;
      if (effective.includes("var(")) queue.push(effective);
    }
  }
}

// specified 값을 resolve하기 전 customProps를 마감하는 공통 전처리. 두 수집 경로(편집/CSS 뷰,
// 피커 툴팁)가 이걸 공유해야 같은 요소에서 같은 토큰 이름이 나온다.
// ① 조상 체인 전체의 custom property를 가까운 쪽부터 보강하고(상속 prop 순회와 독립 — 그건
// 목적을 달성하면 멈춘다), ② computed 승자로 hydrate한다(원문 검증은 그 안에서).
function finalizeCustomProps(
  el: Element,
  values: string[],
  computed: Pick<CSSStyleDeclaration, "getPropertyValue">,
  customProps: Record<string, string>,
  candidates: CustomPropCandidates = new Map(),
): void {
  // 해석할 var()가 없으면 조상 수집도 hydrate도 전부 no-op다 — custom property를 안 쓰는
  // 요소(대다수)에서 체인 순회를 통째로 건너뛴다.
  if (!values.some((v) => v.includes("var("))) return;

  let last: Element | null = null;
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    gapFill(customProps, collectCustomPropsFor(cur, candidates));
    last = cur;
  }
  // shadow 경계·detached 요소는 부모 체인이 documentElement에 닿지 않는다 — :root 토큰을
  // 통째로 잃으므로 마지막에 보정한다(체인이 이미 닿았으면 memo 조회 1회로 끝난다).
  const docEl = el.ownerDocument?.documentElement;
  if (docEl && docEl !== el && docEl !== last) {
    gapFill(customProps, collectCustomPropsFor(docEl, candidates));
  }
  hydrateReferencedCustomProps(values, computed, customProps, candidates);
}

// 수집은 first-write-wins(문서 순서)라 캐스케이드 승자를 보장하지 못한다. 한 스코프의 다른
// 규칙이 같은 이름을 **다른 값**으로 선언했으면 그 후보들을 들고 있다가, hydrate가 computed
// 승자와 대조해 판별한다 — 후보를 버리고 이름만 포기하면 first-write가 실제 승자인 흔한 경우
// (id 규칙·!important·layer 순서)까지 토큰 이름을 잃는다.
export type CustomPropCandidates = Map<string, Set<string>>;

function mergeIntoScope(
  scopeProps: Record<string, string>,
  candidates: CustomPropCandidates,
  ruleProps: Record<string, string>,
): void {
  for (const name in ruleProps) {
    const value = ruleProps[name];
    const prev = scopeProps[name];
    if (prev === undefined) {
      scopeProps[name] = value;
      continue;
    }
    if (prev === value) continue;
    const set = candidates.get(name) ?? new Set([prev]);
    set.add(value);
    candidates.set(name, set);
  }
}

// 스코프 결과를 상위 맵으로 올린다 — 값은 gap-fill(가까운 스코프 우선). 스코프 **간** 재정의는
// 섀도잉이라 후보가 아니고, 스코프 **안**의 후보만 candidates에 이미 쌓여 있다.
function gapFill(
  target: Record<string, string>,
  source: Record<string, string>,
): void {
  for (const name in source) {
    if (!(name in target)) target[name] = source[name];
  }
}

// 한 요소가 선언하는 custom property. **상속 prop을 채우는 조상 순회와 분리한 이유**: 그
// 순회는 목적을 달성하면 멈추므로(INHERITED_PROPS가 다 차면 중단) `body`·`[data-theme]`·
// `:root`에 별칭을 둔 사이트의 원문을 통째로 놓쳤고, 그러면 resolveVarChain이 펼칠 곳이 없어
// 토큰 이름이 리터럴로 무너진다.
// **memo하지 않는다** — 클래스 토글·우리 인라인 편집·cross-origin 시트의 늦은 도착은 캐시
// 세대를 올리지 않아서, 캐싱하면 무효화 계약이 호출부로 새고 그 계약이 새는 순간 같은 증상이
// 재발한다. 위 var() 게이트가 대다수 요소를 걸러내므로 캐시가 벌 몫도 작다.
function collectCustomPropsFor(
  el: Element,
  candidates: CustomPropCandidates,
): Record<string, string> {
  const props: Record<string, string> = {};
  // wantedProps를 비워 일반 prop 작업을 건너뛴다 — `--*`는 그 필터 앞에서 처리되므로
  // 수집 규칙(순서·first-write-wins·cross-origin 보강)은 본 경로와 동일하다.
  collectRulesForElement(el, {}, {}, props, NO_WANTED_PROPS, true, candidates);
  return props;
}
const NO_WANTED_PROPS = new Set<string>();

// 값 안의 var() 참조 이름 — 중첩 fallback(`var(--a, var(--b))`)까지 판다. 정규식(VAR_REF_RE)은
// fallback의 `)`에서 끊겨 안쪽 이름을 놓치므로 괄호 균형 스캐너를 쓴다.
function varRefNames(value: string): string[] {
  if (!value.includes("var(")) return [];
  const names: string[] = [];
  replaceVarRefs(value, (name, fallback, match) => {
    names.push(name);
    if (fallback) names.push(...varRefNames(fallback));
    return match;
  });
  return names;
}

// raw 원문의 var() 참조를 computed 값으로 치환. 이름 하나라도 computed에 없으면 null —
// "원문이 승자와 같은가"를 검증할 수 없다는 뜻이라 호출부가 computed 채택으로 되돌아간다.
function substituteFromComputed(
  value: string,
  computed: Pick<CSSStyleDeclaration, "getPropertyValue">,
  depth = 0,
): string | null {
  if (!value.includes("var(")) return value;
  if (depth > 5) return null;
  let failed = false;
  const out = replaceVarRefs(value, (name, fallback, match) => {
    const v = computed.getPropertyValue(name).trim();
    if (!v) {
      if (fallback) {
        const f = substituteFromComputed(fallback, computed, depth + 1);
        if (f !== null) return f;
      }
      failed = true;
      return match;
    }
    const nested = substituteFromComputed(v, computed, depth + 1);
    if (nested === null) {
      failed = true;
      return match;
    }
    return nested;
  });
  return failed ? null : out;
}

// 같은 값의 다른 표기(색 표기법·대소문자·공백)를 흡수한 비교 — 역참조 조회와 같은 정규화.
function sameResolvedValue(a: string, b: string): boolean {
  const norm = (v: string) =>
    normalizeForLookup(
      v.toLowerCase().replace(/\s*([,/])\s*/g, "$1").replace(/\s+/g, " ").trim(),
    );
  return norm(a) === norm(b);
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
