export function serializeInlineStyle(
  inlineStyle: Record<string, string>,
): string {
  return Object.entries(inlineStyle)
    .map(([prop, value]) => `${prop}: ${value};`)
    .join("\n");
}

export function parseInlineStyle(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const decl of splitTopLevel(text)) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const rawProp = decl.slice(0, colon).trim();
    // 커스텀 프로퍼티(--*)는 케이스 민감 — lowercase 정규화에서 제외.
    const prop = rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!prop || !value) continue;
    result[prop] = value;
  }
  return result;
}

// top-level `;`·개행만 선언 구분자로 취급 — 괄호(url(data:...;base64))·따옴표(content: "a;b")
// 내부는 값의 일부로 보존.
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
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
  return parts;
}
