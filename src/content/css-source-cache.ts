/**
 * Raw CSS source cache.
 *
 * 목적: Chrome CSSOM이 shorthand+longhand override 조합에서 shorthand의 var() 값을
 * 빈 문자열로 explode하는 한계를 우회. 원본 CSS 텍스트를 별도 확보해 룰별로 매핑.
 *
 * 수집 경로:
 *  - <style> 블록: ownerNode.textContent (sync)
 *  - <link rel=stylesheet>: fetch(href) (async, CORS 실패 시 skip → CSSOM fallback)
 *  - adoptedStyleSheets: 각 룰의 cssText 직렬화 (constructable sheet은 explode 없음)
 *
 * 캐시 정책: 픽커 세션 단위. ensureLoaded는 멱등. invalidate + MutationObserver로 재로드.
 */

const ruleToRaw = new Map<CSSStyleRule, Map<string, string>>();
let loadPromise: Promise<void> | null = null;
let isReady = false;
let observer: MutationObserver | null = null;
let observerDebounce: number | null = null;

interface IndexedRule {
  rule: CSSStyleRule;
  sheet: CSSStyleSheet;
  seq: number;
}

interface RuleIndex {
  byClass: Map<string, IndexedRule[]>;
  byTag: Map<string, IndexedRule[]>;
  byId: Map<string, IndexedRule[]>;
  global: IndexedRule[];
}

let ruleIndex: RuleIndex | null = null;

declare global {
  interface Window {
    __BUGSHOT_CSS_DEBUG__?: boolean;
  }
}

function dlog(...args: unknown[]): void {
  if (typeof window !== "undefined" && window.__BUGSHOT_CSS_DEBUG__) {
    // eslint-disable-next-line no-console
    console.info("[bugshot/css-cache]", ...args);
  }
}

export function ensureLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = loadAll().then(() => {
    isReady = true;
  });
  return loadPromise;
}

export function isCacheReady(): boolean {
  return isReady;
}

export function getRawDeclarationsFor(
  rule: CSSStyleRule,
): Map<string, string> | null {
  return ruleToRaw.get(rule) ?? null;
}

export function invalidate(): void {
  ruleToRaw.clear();
  loadPromise = null;
  isReady = false;
  ruleIndex = null;
}

export function getMatchingRules(el: Element): CSSStyleRule[] {
  if (!ruleIndex) ruleIndex = buildRuleIndex();
  const candidates = new Map<CSSStyleRule, IndexedRule>();
  for (const r of ruleIndex.global) candidates.set(r.rule, r);
  const tagRules = ruleIndex.byTag.get(el.tagName.toLowerCase());
  if (tagRules) for (const r of tagRules) candidates.set(r.rule, r);
  if (el.id) {
    const idRules = ruleIndex.byId.get(el.id);
    if (idRules) for (const r of idRules) candidates.set(r.rule, r);
  }
  for (const cls of el.classList) {
    const classRules = ruleIndex.byClass.get(cls);
    if (classRules) for (const r of classRules) candidates.set(r.rule, r);
  }
  const matched: IndexedRule[] = [];
  for (const r of candidates.values()) {
    let m = false;
    try {
      m = el.matches(r.rule.selectorText);
    } catch {
      m = false;
    }
    if (m) matched.push(r);
  }
  matched.sort((a, b) => a.seq - b.seq);
  const result: CSSStyleRule[] = new Array(matched.length);
  for (let i = 0; i < matched.length; i++) result[i] = matched[i].rule;
  return result;
}

function buildRuleIndex(): RuleIndex {
  const idx: RuleIndex = {
    byClass: new Map(),
    byTag: new Map(),
    byId: new Map(),
    global: [],
  };
  let seq = 0;
  for (const sheet of collectAllSheets()) {
    try {
      const rules = sheet.cssRules;
      if (rules) seq = walkRulesForIndex(rules, sheet, idx, seq);
    } catch {
      /* cross-origin */
    }
  }
  dlog("rule index built", {
    byClass: idx.byClass.size,
    byTag: idx.byTag.size,
    byId: idx.byId.size,
    global: idx.global.length,
  });
  return idx;
}

function walkRulesForIndex(
  rules: CSSRuleList,
  sheet: CSSStyleSheet,
  idx: RuleIndex,
  seq: number,
): number {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      indexStyleRule(rule, sheet, idx, seq++);
      continue;
    }
    if (rule instanceof CSSMediaRule) {
      try {
        if (!window.matchMedia(rule.conditionText).matches) continue;
      } catch {
        /* fall through */
      }
      seq = walkRulesForIndex(rule.cssRules, sheet, idx, seq);
      continue;
    }
    if (rule instanceof CSSSupportsRule) {
      try {
        if (!CSS.supports(rule.conditionText)) continue;
      } catch {
        /* fall through */
      }
      seq = walkRulesForIndex(rule.cssRules, sheet, idx, seq);
      continue;
    }
    const nested = (rule as { cssRules?: CSSRuleList }).cssRules;
    if (nested) seq = walkRulesForIndex(nested, sheet, idx, seq);
  }
  return seq;
}

function indexStyleRule(
  rule: CSSStyleRule,
  sheet: CSSStyleSheet,
  idx: RuleIndex,
  seq: number,
): void {
  const entry: IndexedRule = { rule, sheet, seq };
  const parts = splitSelectorList(rule.selectorText);
  let isGlobal = false;
  const seenClass = new Set<string>();
  const seenId = new Set<string>();
  const seenTag = new Set<string>();
  for (const part of parts) {
    const last = lastCompound(part);
    const tokens = extractSimpleTokens(last);
    if (
      tokens.any ||
      (!tokens.tag && tokens.classes.length === 0 && tokens.ids.length === 0)
    ) {
      isGlobal = true;
      continue;
    }
    if (tokens.tag && !seenTag.has(tokens.tag)) {
      seenTag.add(tokens.tag);
      addEntry(idx.byTag, tokens.tag, entry);
    }
    for (const cls of tokens.classes) {
      if (seenClass.has(cls)) continue;
      seenClass.add(cls);
      addEntry(idx.byClass, cls, entry);
    }
    for (const id of tokens.ids) {
      if (seenId.has(id)) continue;
      seenId.add(id);
      addEntry(idx.byId, id, entry);
    }
  }
  if (isGlobal) idx.global.push(entry);
}

function addEntry(
  m: Map<string, IndexedRule[]>,
  key: string,
  entry: IndexedRule,
): void {
  let list = m.get(key);
  if (!list) {
    list = [];
    m.set(key, list);
  }
  list.push(entry);
}

function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(selectorText.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = selectorText.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function lastCompound(selector: string): string {
  let depth = 0;
  let lastBoundary = -1;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (
      depth === 0 &&
      (ch === " " || ch === "\t" || ch === ">" || ch === "+" || ch === "~")
    ) {
      lastBoundary = i;
    }
  }
  return selector.slice(lastBoundary + 1).trim();
}

interface SimpleTokens {
  tag?: string;
  classes: string[];
  ids: string[];
  any: boolean;
}

function extractSimpleTokens(compound: string): SimpleTokens {
  const tokens: SimpleTokens = { classes: [], ids: [], any: false };
  if (!compound) {
    tokens.any = true;
    return tokens;
  }
  let i = 0;
  const tagMatch = /^([a-zA-Z][\w-]*)/.exec(compound);
  if (tagMatch) {
    tokens.tag = tagMatch[1].toLowerCase();
    i = tagMatch[0].length;
  }
  while (i < compound.length) {
    const ch = compound[i];
    if (ch === ".") {
      const m = /^\.([a-zA-Z_-][\w-]*)/.exec(compound.slice(i));
      if (!m) {
        tokens.any = true;
        break;
      }
      tokens.classes.push(m[1]);
      i += m[0].length;
    } else if (ch === "#") {
      const m = /^#([a-zA-Z_-][\w-]*)/.exec(compound.slice(i));
      if (!m) {
        tokens.any = true;
        break;
      }
      tokens.ids.push(m[1]);
      i += m[0].length;
    } else if (ch === ":") {
      i = skipPseudo(compound, i);
    } else if (ch === "[") {
      i = skipBracket(compound, i);
    } else if (ch === "*") {
      i++;
    } else {
      tokens.any = true;
      break;
    }
  }
  return tokens;
}

function skipPseudo(s: string, i: number): number {
  i++;
  if (s[i] === ":") i++;
  const nameMatch = /^[a-zA-Z][\w-]*/.exec(s.slice(i));
  if (nameMatch) i += nameMatch[0].length;
  if (s[i] === "(") {
    let depth = 1;
    i++;
    while (i < s.length && depth > 0) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      i++;
    }
  }
  return i;
}

function skipBracket(s: string, i: number): number {
  let depth = 1;
  i++;
  while (i < s.length && depth > 0) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]") depth--;
    i++;
  }
  return i;
}

export function startObserver(): void {
  if (observer) return;
  observer = new MutationObserver((muts) => {
    if (!isRelevant(muts)) return;
    if (observerDebounce != null) clearTimeout(observerDebounce);
    observerDebounce = window.setTimeout(() => {
      observerDebounce = null;
      invalidate();
      void ensureLoaded();
    }, 200);
  });
  // head만 관찰 — 99% stylesheet은 head에 추가됨. body 변경 폭증 사이트(SPA)에서 콜백 폭증 회피.
  observer.observe(document.head, {
    childList: true,
    subtree: true,
  });
}

export function stopObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (observerDebounce != null) {
    clearTimeout(observerDebounce);
    observerDebounce = null;
  }
}

function isRelevant(muts: MutationRecord[]): boolean {
  for (const m of muts) {
    if (m.type !== "childList") continue;
    for (const n of Array.from(m.addedNodes)) {
      if (n.nodeName === "LINK" || n.nodeName === "STYLE") return true;
    }
    for (const n of Array.from(m.removedNodes)) {
      if (n.nodeName === "LINK" || n.nodeName === "STYLE") return true;
    }
  }
  return false;
}

/* ── load ────────────────────────────────────────── */

async function loadAll(): Promise<void> {
  const sheets = collectAllSheets();
  dlog("loadAll start", { sheetCount: sheets.length });
  await Promise.all(
    sheets.map((sheet, i) =>
      loadSheet(sheet).catch((err) => dlog("loadSheet error", { i, err })),
    ),
  );
  dlog("loadAll done", { mappedRules: ruleToRaw.size });
}

function collectAllSheets(): CSSStyleSheet[] {
  const regular = Array.from(document.styleSheets) as CSSStyleSheet[];
  const adopted = document.adoptedStyleSheets
    ? Array.from(document.adoptedStyleSheets)
    : [];
  return [...regular, ...adopted];
}

async function loadSheet(sheet: CSSStyleSheet): Promise<void> {
  const owner = sheet.ownerNode;
  let text: string | null = null;
  let kind = "unknown";
  if (owner instanceof HTMLStyleElement) {
    text = owner.textContent ?? "";
    kind = "inline";
  } else if (owner instanceof HTMLLinkElement && sheet.href) {
    text = await fetchSheetText(sheet.href);
    kind = "external";
    dlog("fetched", { href: sheet.href, ok: text != null, len: text?.length ?? 0 });
  } else if (!owner) {
    text = serializeAdoptedSheet(sheet);
    kind = "adopted";
  }
  if (text == null) {
    dlog("skip — no text", { kind, href: sheet.href });
    return;
  }
  alignAndStore(sheet, text, kind);
}

async function fetchSheetText(href: string): Promise<string | null> {
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) {
      dlog("skip cross-origin", { href });
      return null;
    }
    const res = await fetch(href, { credentials: "omit" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function serializeAdoptedSheet(sheet: CSSStyleSheet): string | null {
  try {
    const rules = sheet.cssRules;
    if (!rules) return null;
    return Array.from(rules)
      .map((r) => r.cssText)
      .join("\n");
  } catch {
    return null;
  }
}

function alignAndStore(
  sheet: CSSStyleSheet,
  text: string,
  kind: string,
): void {
  const parsed: ParsedRule[] = [];
  parseStylesheet(text, parsed);

  const cssomFlat: CSSStyleRule[] = [];
  try {
    flattenStyleRules(sheet.cssRules, cssomFlat);
  } catch (err) {
    dlog("cssRules access denied", { kind, href: sheet.href, err });
    return;
  }

  // Group parsed rules by normalized selector → list (preserves source order)
  const parsedBySelector = new Map<string, ParsedRule[]>();
  for (const p of parsed) {
    const key = normalizeSelector(p.selectorText);
    let list = parsedBySelector.get(key);
    if (!list) {
      list = [];
      parsedBySelector.set(key, list);
    }
    list.push(p);
  }

  // Walk CSSOM rules in order, consume parsed by selector occurrence
  const consumed = new Map<string, number>();
  let mapped = 0;
  let missed = 0;
  for (const rule of cssomFlat) {
    const key = normalizeSelector(rule.selectorText);
    const list = parsedBySelector.get(key);
    if (!list) {
      missed++;
      continue;
    }
    const idx = consumed.get(key) ?? 0;
    if (idx >= list.length) {
      missed++;
      continue;
    }
    ruleToRaw.set(rule, list[idx].decls);
    consumed.set(key, idx + 1);
    mapped++;
  }
  dlog("aligned", {
    kind,
    href: sheet.href,
    cssomRules: cssomFlat.length,
    parsedRules: parsed.length,
    mapped,
    missed,
  });
}

function flattenStyleRules(
  rules: CSSRuleList | undefined,
  out: CSSStyleRule[],
): void {
  if (!rules) return;
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      out.push(rule);
    } else {
      const nested = (rule as { cssRules?: CSSRuleList }).cssRules;
      if (nested) flattenStyleRules(nested, out);
    }
  }
}

function normalizeSelector(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/* ── parser ──────────────────────────────────────── */

interface ParsedRule {
  selectorText: string;
  decls: Map<string, string>;
}

function parseStylesheet(text: string, out: ParsedRule[]): void {
  const cleaned = stripComments(text);
  parseRulesFrom(cleaned, 0, cleaned.length, out);
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

const NESTED_AT_RULES = new Set([
  "media",
  "supports",
  "layer",
  "container",
  "scope",
]);

function parseRulesFrom(
  text: string,
  start: number,
  end: number,
  out: ParsedRule[],
): void {
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(text[i])) i++;
    if (i >= end) break;

    if (text[i] === "@") {
      const atName = readAtName(text, i, end);
      // find { or ; (depth-aware)
      let j = i;
      let depth = 0;
      let inString: string | null = null;
      while (j < end) {
        const ch = text[j];
        if (inString) {
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === inString) inString = null;
          j++;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = ch;
          j++;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && (ch === "{" || ch === ";")) break;
        j++;
      }
      if (j >= end) return;
      if (text[j] === ";") {
        i = j + 1;
        continue;
      }
      const blockEnd = findMatchingBrace(text, j, end);
      if (blockEnd < 0) return;
      if (NESTED_AT_RULES.has(atName)) {
        parseRulesFrom(text, j + 1, blockEnd, out);
      }
      // skip @keyframes, @font-face, @page, etc.
      i = blockEnd + 1;
      continue;
    }

    // style rule: selector { decls }
    let j = i;
    let inString: string | null = null;
    while (j < end) {
      const ch = text[j];
      if (inString) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === inString) inString = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        j++;
        continue;
      }
      if (ch === "{") break;
      j++;
    }
    if (j >= end) return;
    const selectorText = text.slice(i, j).trim();
    const blockEnd = findMatchingBrace(text, j, end);
    if (blockEnd < 0) return;
    const declText = text.slice(j + 1, blockEnd);
    const decls = new Map<string, string>();
    parseDeclBlock(declText, decls);
    if (selectorText) {
      out.push({ selectorText, decls });
    }
    i = blockEnd + 1;
  }
}

function readAtName(text: string, start: number, end: number): string {
  let i = start + 1;
  while (i < end && /[\w-]/.test(text[i])) i++;
  return text.slice(start + 1, i).toLowerCase();
}

function findMatchingBrace(text: string, openIdx: number, end: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < end; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseDeclBlock(text: string, out: Map<string, string>): void {
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;

    const propStart = i;
    let colon = -1;
    let inString: string | null = null;
    while (i < n) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        i++;
        continue;
      }
      if (ch === ":") {
        colon = i;
        break;
      }
      if (ch === ";" || ch === "}") break;
      i++;
    }
    if (colon < 0) {
      while (i < n && text[i] !== ";") i++;
      i++;
      continue;
    }

    const prop = text.slice(propStart, colon).trim().toLowerCase();
    const valueStart = colon + 1;
    let depth = 0;
    inString = null;
    let valueEnd = n;
    let j = valueStart;
    while (j < n) {
      const ch = text[j];
      if (inString) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === inString) inString = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        j++;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === ";" && depth === 0) {
        valueEnd = j;
        break;
      }
      j++;
    }
    let value = text.slice(valueStart, valueEnd).trim();
    value = value.replace(/!\s*important\s*$/i, "").trim();
    if (prop && value) out.set(prop, value);
    i = valueEnd + 1;
  }
}
