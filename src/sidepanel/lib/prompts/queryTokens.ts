export type QueryTier = "quoted" | "ident" | "word";

export interface QueryTerm {
  term: string; // 소문자 정규화
  tier: QueryTier;
}

const MIN_TERM_LEN = 3;
const MAX_QUERY_TERMS = 20;

// 식별자 보존: 경로·구분자ID·camelCase·digit포함·ALLCAPS를 통짜로 잡는다(순진한 split은
// ORD-4821을 부순다). 앞 tier에서 잡힌 조각은 공백으로 마스킹해 다음 tier가 재추출 안 하게 한다.
const IDENT_RE =
  /\/[^\s"'`]*|[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)+|[A-Za-z]*[A-Z][a-z]+[A-Za-z]*|[A-Za-z]+\d[A-Za-z0-9]*|[A-Z]{3,}/g;
const QUOTED_RE = /["'`]([^"'`]{2,}?)["'`]/g;
const WORD_RE = /[\p{L}\p{N}]{3,}/gu;

// userPrompt·기존 초안·콘솔 에러·액션·selector·tagName를 검색 term으로 쪼갠다.
export function tokenizeUserQuery(sources: string[]): QueryTerm[] {
  const seen = new Set<string>();
  const out: QueryTerm[] = [];

  const add = (raw: string, tier: QueryTier) => {
    const term = raw.trim().toLowerCase();
    if (!term) return;
    // MIN_TERM_LEN 미만 폐기 — quoted와 숫자 포함(식별자성)은 예외.
    if (tier !== "quoted" && term.length < MIN_TERM_LEN && !/\d/.test(term)) return;
    if (seen.has(term) || out.length >= MAX_QUERY_TERMS) return;
    seen.add(term);
    out.push({ term, tier });
  };

  for (const src of sources) {
    if (!src || !src.trim()) continue;
    let rest = src;
    rest = rest.replace(QUOTED_RE, (_, inner: string) => {
      add(inner, "quoted");
      return " ";
    });
    rest = rest.replace(IDENT_RE, (m) => {
      add(m, "ident");
      return " ";
    });
    for (const w of rest.match(WORD_RE) ?? []) add(w, "word");
  }

  return out;
}
