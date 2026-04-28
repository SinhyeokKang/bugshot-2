import type {
  PickerSelectionPayload,
  Token,
  TokenCategory,
} from "@/types/picker";

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
};

const VAR_REF_RE = /var\(\s*(--[\w-]+)(?:\s*,\s*([^)]*))?\)/g;
const SIMPLE_VAR_FALLBACK_RE = /^\s*var\(\s*(--[\w-]+)(?:\s*,\s*[^)]*)?\s*\)\s*$/;
const CSS_DECL_RE = /([\w-]+)\s*:\s*([^;]+)/g;

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
  const editableText = findEditableTextNode(el);
  return {
    selector,
    tagName,
    classList,
    computedStyles,
    specifiedStyles,
    propSources,
    hasParent,
    hasChild,
    text: editableText ? (editableText.textContent ?? "") : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export function collectSpecifiedStyles(el: Element): Record<string, string> {
  return collectSpecifiedStylesWithSources(el).styles;
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
  backgroundColor?: string;
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

  const colorRaw = formatColor(cs.color) ?? cs.color;
  const color = matchToken(colorRaw, tokens) ?? colorRaw;

  const bgRaw = formatColor(cs.backgroundColor);
  const backgroundColor = bgRaw
    ? (matchToken(bgRaw, tokens) ?? bgRaw)
    : undefined;

  const family = parseFirstFontFamily(cs.fontFamily);
  const fontSize = matchToken(cs.fontSize, tokens) ?? cs.fontSize;
  const fontWeight = matchToken(cs.fontWeight, tokens) ?? cs.fontWeight;

  return {
    tag,
    classes,
    classOverflow,
    width: rect.width,
    height: rect.height,
    color,
    backgroundColor,
    fontSize,
    fontWeight,
    fontFamily: family,
    padding: matchTokenScalar(
      shortenBox([cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]),
      tokens,
    ),
    borderRadius: matchTokenScalar(
      shortenBox([
        cs.borderTopLeftRadius,
        cs.borderTopRightRadius,
        cs.borderBottomRightRadius,
        cs.borderBottomLeftRadius,
      ]),
      tokens,
    ),
  };
}

function matchToken(value: string, tokens?: TokenLookup): string | undefined {
  if (!tokens || !value) return undefined;
  const key = normalizeForLookup(value);
  return key ? tokens.get(key) : undefined;
}

function matchTokenScalar(
  value: string | undefined,
  tokens?: TokenLookup,
): string | undefined {
  if (!value) return value;
  if (value.includes(" ")) return value;
  return matchToken(value, tokens) ?? value;
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
  const m = v.match(/^rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/);
  if (!m) return v;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function parseFirstFontFamily(value: string): string {
  if (!value) return "";
  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "");
}

function shortenBox(values: [string, string, string, string]): string | undefined {
  const [t, r, b, l] = values;
  const allZero = values.every((v) => parseFloat(v) === 0);
  if (allZero) return undefined;
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
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
): void {
  for (const sheet of allStyleSheets()) {
    try {
      const rules = sheet.cssRules;
      if (rules) collectSpecifiedFromRules(rules, el, out, sources, customProps);
    } catch {
      /* cross-origin, skip */
    }
  }
  if (el instanceof HTMLElement) {
    const style = el.style;
    extractVarPropsFromCssText(style.cssText, out, sources, customProps, "[inline]");
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      const val = style.getPropertyValue(name);
      if (!val) continue;
      if (name.startsWith("--")) {
        if (!customProps[name]) customProps[name] = val.trim();
        continue;
      }
      if (!(out[name]?.includes("var(") && !val.includes("var("))) {
        out[name] = val;
        sources[name] = "[inline]";
      }
    }
    for (const shorthand of Object.keys(SHORTHAND_MAP)) {
      const val = style.getPropertyValue(shorthand);
      if (val && !(out[shorthand]?.includes("var(") && !val.includes("var("))) {
        out[shorthand] = val;
        sources[shorthand] = "[inline]";
      }
    }
  }
}

function collectSpecifiedFromRules(
  rules: CSSRuleList,
  el: Element,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
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
      const ruleSelector = rule.selectorText;
      extractVarPropsFromCssText(decl.cssText, out, sources, customProps, ruleSelector);
      for (let i = 0; i < decl.length; i++) {
        const name = decl.item(i);
        const val = decl.getPropertyValue(name);
        if (!val) continue;
        if (name.startsWith("--")) {
          if (!customProps[name]) customProps[name] = val.trim();
          continue;
        }
        if (!(out[name]?.includes("var(") && !val.includes("var("))) {
          out[name] = val;
          sources[name] = ruleSelector;
        }
      }
      for (const shorthand of Object.keys(SHORTHAND_MAP)) {
        const val = decl.getPropertyValue(shorthand);
        if (val && !(out[shorthand]?.includes("var(") && !val.includes("var("))) {
          out[shorthand] = val;
          sources[shorthand] = ruleSelector;
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
      collectSpecifiedFromRules(nested, el, out, sources, customProps);
    } else if (rule instanceof CSSSupportsRule) {
      try {
        if (!CSS.supports(rule.conditionText)) continue;
      } catch {
        /* fall through */
      }
      collectSpecifiedFromRules(nested, el, out, sources, customProps);
    } else {
      collectSpecifiedFromRules(nested, el, out, sources, customProps);
    }
  }
}

function extractVarPropsFromCssText(
  cssText: string,
  out: Record<string, string>,
  sources: Record<string, string>,
  customProps: Record<string, string>,
  origin: string,
): void {
  const declared: Record<string, string> = {};
  CSS_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_DECL_RE.exec(cssText)) !== null) {
    declared[m[1]] = m[2].trim();
  }
  for (const [prop, val] of Object.entries(declared)) {
    if (prop.startsWith("--")) {
      if (!customProps[prop]) customProps[prop] = val;
      continue;
    }
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
      if (lh in declared) continue;
      const lhVal = split ? split[j] : val;
      if (!out[lh] || !out[lh].includes("var(")) {
        out[lh] = lhVal;
        sources[lh] = origin;
      }
    }
  }
}

function expandShorthands(
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
}

function splitTrblValue(value: string): [string, string, string, string] | null {
  if (value.includes("/")) return null;
  const parts = splitCssTokens(value);
  if (parts.length === 0 || parts.length > 4) return null;
  const [a, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}

function splitCssTokens(value: string): string[] {
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

function resolveVarChain(
  value: string,
  customProps: Record<string, string>,
  depth = 0,
  visited?: Set<string>,
): string {
  if (depth > 5 || !value.includes("var(")) return value;
  const seen = visited ?? new Set<string>();
  let changed = false;
  VAR_REF_RE.lastIndex = 0;
  const next = value.replace(
    VAR_REF_RE,
    (match, name: string, fallback: string | undefined) => {
      if (seen.has(name)) return match;
      seen.add(name);
      let resolvedName = name;
      let replacement = customProps[name];
      if (replacement === undefined && fallback) {
        const fb = SIMPLE_VAR_FALLBACK_RE.exec(fallback.trim());
        if (fb && !seen.has(fb[1]) && customProps[fb[1]] !== undefined) {
          resolvedName = fb[1];
          replacement = customProps[fb[1]];
          seen.add(fb[1]);
        }
      }
      if (replacement === undefined) return match;
      const isPrivate = resolvedName.startsWith("--_");
      if (!isPrivate) return match;
      changed = true;
      return replacement;
    },
  );
  if (!changed) return value;
  return resolveVarChain(next, customProps, depth + 1, seen);
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
  if (/^(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|repeating-conic-gradient|url|image-set)\(/i.test(v))
    return "image";
  if (
    /^-?\d*\.?\d+(px|rem|em|%|vw|vh|ch|ex|vmin|vmax|pt|pc|cm|mm|in)$/.test(v)
  )
    return "length";
  if (/^-?\d*\.?\d+$/.test(v)) return "number";
  return "unknown";
}
