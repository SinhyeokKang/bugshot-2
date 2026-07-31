export function serializeInlineStyle(
  inlineStyle: Record<string, string>,
): string {
  return Object.entries(inlineStyle)
    .map(([prop, value]) => `${prop}: ${value};`)
    .join("\n");
}

export function parseInlineStyle(text: string): Record<string, string> {
  return parseInlineStyleDraft(text).declarations;
}

export type InlineStyleDraft =
  | { valid: true; declarations: Record<string, string>; raw: string }
  | { valid: false; declarations: Record<string, string>; raw: string };

export function parseInlineStyleDraft(text: string): InlineStyleDraft {
  const result: Record<string, string> = {};
  const split = splitTopLevel(text);
  let hasDuplicateDeclaration = false;
  for (const decl of split.parts) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const rawProp = stripComments(decl.slice(0, colon)).trim();
    // 커스텀 프로퍼티(--*)는 케이스 민감 — lowercase 정규화에서 제외.
    const prop = rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!prop || !value) continue;
    if (prop in result) hasDuplicateDeclaration = true;
    result[prop] = value;
  }
  const hasIncompleteDeclaration = split.parts.some((decl) => {
    const clean = stripComments(decl).trim();
    if (!clean) return false;
    const colon = clean.indexOf(":");
    return colon === -1 || !clean.slice(colon + 1).trim();
  });
  return {
    // Record 기반 DOM overlay는 fallback 중복 선언의 순서를 표현할 수 없다. 조용히
    // last-write로 축약하지 않고 raw draft로 보존해 DOM/store commit을 막는다.
    valid: split.complete && !hasIncompleteDeclaration && !hasDuplicateDeclaration,
    declarations: result,
    raw: text,
  };
}

// top-level `;`·개행만 선언 구분자로 취급 — 괄호(url(data:...;base64))·따옴표(content: "a;b")
// 내부는 값의 일부로 보존.
function splitTopLevel(text: string): { parts: string[]; complete: boolean } {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let comment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (comment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        comment = false;
      }
      continue;
    }
    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      current += `${ch}${next}`;
      i++;
      comment = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === ";" || ch === "\n") && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return { parts, complete: !quote && !comment && depth === 0 };
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}
