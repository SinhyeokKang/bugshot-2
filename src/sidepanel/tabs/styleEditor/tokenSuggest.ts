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
  // 접두가 중첩되면(--color-blue- ⊂ --color-) 같은 토큰이 여러 그룹에 걸린다 — 앞선
  // 그룹이 가져간 토큰은 뒤 그룹에서 뺀다(그룹 간 dedup, primary 제외와 같은 기준).
  const familySet = new Set<string>();
  const familyGroups = familyPrefixes.map((prefix) => {
    const tokens = base.filter(
      (t) => t.name.startsWith(prefix) && !familySet.has(t.name),
    );
    for (const t of tokens) familySet.add(t.name);
    return { prefix, tokens };
  });
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

// CodeMirror var() 자동완성의 검색어. 커서가 걸친 이름이 **이미 존재하는 토큰**이면
// (= 교체하려고 연 것) 검색어를 비워 family 전체를 보여준다 — 그대로 필터하면 이름 전체가
// query가 돼 sibling이 사라진다. ValueCombobox가 draft가 var(…)면 검색어를 비우는 것과 같은 규칙.
export function tokenCompletionQuery(
  fullName: string,
  prefix: string,
  tokens: Token[],
): string {
  if (fullName && tokens.some((t) => t.name === fullName)) return "";
  return prefix;
}

// label 안에서 query(대소문자 무시)가 처음 매칭되는 [start, end] 범위. 없거나 빈 query면 [].
// CodeMirror 자동완성 getMatch(매칭 글자 강조 범위)용.
export function matchRange(label: string, query: string): readonly number[] {
  if (!query) return [];
  const i = label.toLowerCase().indexOf(query.toLowerCase());
  return i < 0 ? [] : [i, i + query.length];
}
