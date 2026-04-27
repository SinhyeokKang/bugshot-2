import type { Token } from "@/types/picker";

export interface TokenRef {
  name: string;
  multiplier?: number;
}

export function extractTokenRefs(value: string): TokenRef[] {
  const refs: TokenRef[] = [];
  const re = /var\(\s*(--[^\s,)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const name = m[1];
    if (isInternalToken(name)) continue;
    const mul = readMultiplierAround(value, m.index, re.lastIndex);
    refs.push(mul == null ? { name } : { name, multiplier: mul });
  }
  return refs;
}

export function isInternalToken(name: string): boolean {
  return name.startsWith("--tw-");
}

export function isTokenValue(v: string): boolean {
  return v.includes("var(");
}

export function tokenFamilyPrefix(
  name: string,
  allTokens: Token[],
): string | null {
  let end = name.lastIndexOf("-");
  while (end > 2) {
    const prefix = name.slice(0, end + 1);
    const count = allTokens.filter((t) => t.name.startsWith(prefix)).length;
    if (count >= 2) return prefix;
    end = name.lastIndexOf("-", end - 1);
  }
  return null;
}

export function findTokenValue(tokens: Token[], name: string): string | undefined {
  return tokens.find((t) => t.name === name)?.value;
}

function readMultiplierAround(
  full: string,
  varStart: number,
  cursor: number,
): number | undefined {
  let depth = 0;
  let end = cursor;
  while (end < full.length) {
    const ch = full[end];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    }
    end++;
  }
  const tail = full.slice(end + 1);
  const tailMatch = tail.match(/^\s*\*\s*(-?\d*\.?\d+)/);
  if (tailMatch) return parseFloat(tailMatch[1]);
  const head = full.slice(0, varStart);
  const headMatch = head.match(/(-?\d*\.?\d+)\s*\*\s*$/);
  if (headMatch) return parseFloat(headMatch[1]);
  return undefined;
}
