import type { Token, TokenCategory } from "@/types/picker";
import { tokenFamilyPrefix } from "./tokenUtils";

// 편집 패널(ValueCombobox)과 CSS 코드 뷰(var() 자동완성)가 공유하는 토큰 제안 로직.
// 표현 방식만 다를 뿐(Command 리스트 vs CodeMirror combobox) 필터·정렬 규칙은 단일 출처.

// LIKE 매칭 — query가 name 또는 value에 부분문자열로 포함되면 통과. 빈 query면 전체.
export function filterTokensByQuery(list: Token[], query: string): Token[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (t) =>
      t.name.toLowerCase().includes(q) || t.value.toLowerCase().includes(q),
  );
}

// 활성 토큰 이름들의 family 접두(2개 이상 공유하는 prefix)를 중복 없이 수집.
export function tokenFamilyPrefixes(
  names: string[],
  tokens: Token[],
): string[] {
  const prefixes: string[] = [];
  for (const n of names) {
    const p = tokenFamilyPrefix(n, tokens);
    if (p && !prefixes.includes(p)) prefixes.push(p);
  }
  return prefixes;
}

export interface TokenGroups {
  familyGroups: { prefix: string; tokens: Token[] }[];
  primary: Token[];
  extra: Token[];
}

// category 우선(base = 해당 category) + family(활성 토큰 접두) 그룹 우선.
// category 없으면 전체가 primary, extra 없음.
export function groupTokensByFamily(
  tokens: Token[],
  category: TokenCategory | undefined,
  familyPrefixes: string[],
): TokenGroups {
  const base = !category
    ? tokens
    : tokens.filter((t) => t.category === category);
  const extra = category
    ? tokens.filter((t) => t.category !== category && t.category !== "unknown")
    : [];
  if (familyPrefixes.length === 0)
    return { familyGroups: [], primary: base, extra };
  const familyGroups = familyPrefixes.map((prefix) => ({
    prefix,
    tokens: base.filter((t) => t.name.startsWith(prefix)),
  }));
  const familySet = new Set(
    familyGroups.flatMap((g) => g.tokens.map((t) => t.name)),
  );
  return {
    familyGroups,
    primary: base.filter((t) => !familySet.has(t.name)),
    extra,
  };
}

// family → primary → extra 순으로 평탄화(CodeMirror 옵션처럼 단일 정렬 리스트가 필요할 때).
export function flattenTokenGroups(g: TokenGroups): Token[] {
  return [...g.familyGroups.flatMap((x) => x.tokens), ...g.primary, ...g.extra];
}
