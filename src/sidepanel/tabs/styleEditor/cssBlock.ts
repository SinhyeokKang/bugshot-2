import { parseInlineStyle, serializeInlineStyle } from "./inlineCssText";

export function serializeCssBlock(
  selector: string,
  decls: Record<string, string>,
): string {
  // 들여쓰기는 리터럴 공백이 아니라 에디터 line decoration(cm-body-indent)으로 처리 —
  // 프로포셔널 폰트에서 px 정렬이 정확하고, selector 줄은 제외할 수 있다(parse는 공백 무시).
  const body = serializeInlineStyle(decls);
  if (!body) return `${selector} {\n}`;
  return `${selector} {\n${body}\n}`;
}

export function parseCssBlock(text: string): Record<string, string> {
  const open = text.indexOf("{");
  if (open === -1) return parseInlineStyle(text);
  const close = text.lastIndexOf("}");
  const body = close > open ? text.slice(open + 1, close) : text.slice(open + 1);
  return parseInlineStyle(body);
}

// TRBL(4면) shorthand ↔ longhand 그룹. 값-순서는 [top,right,bottom,left] /
// border-radius는 [TL,TR,BR,BL] — 둘 다 인덱스 0==2·1==3 규칙이라 단일 로직으로 처리.
const TRBL_GROUPS: Record<string, [string, string, string, string]> = {
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  inset: ["top", "right", "bottom", "left"],
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
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
};

// top-level 공백만 토큰 구분자 — 괄호 내부(`rgb(255, 0, 0)`·`var()`) 공백은 값의 일부.
function splitTokens(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// shorthand 값 → 4면(표준 TRBL 1~4값 규칙). 코너 순서도 동일 인덱스라 그대로.
function fourFromTokens(toks: string[]): [string, string, string, string] {
  const [t, r = t, b = t, l = r] = toks;
  return [t!, r!, b!, l!];
}

// 4면 → 최소 shorthand 값(4→3→2→1 축약).
function collapseValue(t: string, r: string, b: string, l: string): string {
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

// TRBL shorthand → longhand 4면 전개. `/`(elliptical radius)·5토큰 이상은 opaque 유지.
export function expandTrbl(
  decls: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, value] of Object.entries(decls)) {
    const sides = TRBL_GROUPS[prop];
    const toks = sides && !value.includes("/") ? splitTokens(value) : null;
    if (sides && toks && toks.length >= 1 && toks.length <= 4) {
      const four = fourFromTokens(toks);
      sides.forEach((k, i) => {
        out[k] = four[i]!;
      });
    } else {
      out[prop] = value;
    }
  }
  return out;
}

// longhand 4면(모두 존재) → shorthand. 첫 longhand 위치에 shorthand를 두어 순서 보존.
// 면 값에 top-level 공백(elliptical 코너 등)이 있으면 안전하게 collapse 생략.
export function collapseTrbl(
  decls: Record<string, string>,
): Record<string, string> {
  const sideToShort = new Map<string, string>();
  for (const [short, sides] of Object.entries(TRBL_GROUPS)) {
    const complete =
      sides.every((k) => k in decls) &&
      !sides.some((k) => splitTokens(decls[k]!).length > 1);
    if (complete) for (const k of sides) sideToShort.set(k, short);
  }
  const out: Record<string, string> = {};
  const emitted = new Set<string>();
  for (const [prop, value] of Object.entries(decls)) {
    const short = sideToShort.get(prop);
    if (!short) {
      out[prop] = value;
      continue;
    }
    if (!emitted.has(short)) {
      const [t, r, b, l] = TRBL_GROUPS[short]!.map((k) => decls[k]!);
      out[short] = collapseValue(t!, r!, b!, l!);
      emitted.add(short);
    }
  }
  return out;
}

// 블록 본문 한 줄이 실제 적용되는 완결 선언(`prop: value`)인지 — 적용 경로(parseInlineStyle)와
// 동일 기준. lezer 증분 파싱이 tag-prefixed 속성(`table-layout` 등, 앞 세그먼트가 HTML 태그명)을
// 콜론 없이 타이핑하던 순간 셀렉터(TagName)로 오분류하고 그 해석이 안 풀리는 경우가 있는데,
// 이 기준으로 "미적용" 취소선을 억제해 실제 적용 여부와 시각 신호를 일치시킨다.
export function isCompleteDeclarationLine(lineText: string): boolean {
  const colon = lineText.indexOf(":");
  if (colon <= 0) return false;
  if (!lineText.slice(0, colon).trim()) return false;
  const value = lineText.slice(colon + 1).replace(/;\s*$/, "").trim();
  return value.length > 0;
}

// specified 대비 diff. 값이 다르거나 새로 추가된 prop만 오버라이드로 남기고,
// specified에 있었으나 edited에서 빠진 prop은 `initial` 원복으로 방출(삭제=원복).
export function computeOverrides(
  edited: Record<string, string>,
  specified: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [prop, value] of Object.entries(edited)) {
    if (specified[prop] !== value) result[prop] = value;
  }
  for (const prop of Object.keys(specified)) {
    if (!(prop in edited)) result[prop] = "initial";
  }
  return result;
}
