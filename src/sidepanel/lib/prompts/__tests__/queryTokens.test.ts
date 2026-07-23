import { describe, it, expect } from "vitest";
import { tokenizeUserQuery, type QueryTerm } from "../queryTokens";

// term → tier 조회 헬퍼 (순서에 의존하지 않는 단정).
function tierOf(terms: QueryTerm[], term: string): string | undefined {
  return terms.find((t) => t.term === term)?.tier;
}
function values(terms: QueryTerm[]): string[] {
  return terms.map((t) => t.term);
}

describe("tokenizeUserQuery — 3-tier 추출", () => {
  it("quoted \"ORD-4821\" 추출 + tier=quoted (소문자 정규화)", () => {
    const terms = tokenizeUserQuery(['주문 "ORD-4821" 이 안 떠요']);
    expect(values(terms)).toContain("ord-4821");
    expect(tierOf(terms, "ord-4821")).toBe("quoted");
  });

  it("ident 보존: 경로·camelCase·예외명·하이픈ID가 통짜 term (쪼개지지 않음)", () => {
    const terms = tokenizeUserQuery([
      "orderStatus is null at /api/v2/orders — NullPointerException ORD-4821",
    ]);
    const v = values(terms);
    expect(v).toContain("orderstatus");
    expect(v).toContain("/api/v2/orders");
    expect(v).toContain("nullpointerexception");
    expect(v).toContain("ord-4821");
  });

  it("word tier: 3자 이상 한글·영문 유지, 2자 이하 폐기(MIN_TERM_LEN=3)", () => {
    const terms = tokenizeUserQuery(["주문서 주문 the ok"]);
    const v = values(terms);
    expect(v).toContain("주문서"); // 3자 유지
    expect(v).toContain("the"); // 3자 유지
    expect(v).not.toContain("주문"); // 2자 폐기
    expect(v).not.toContain("ok"); // 2자 폐기
  });

  it("소문자 정규화 + 중복 term 제거", () => {
    const terms = tokenizeUserQuery(["Order ORDER order Status"]);
    expect(values(terms).filter((t) => t === "order")).toHaveLength(1);
  });

  it("distinct MAX_QUERY_TERMS=20개 캡", () => {
    const many = Array.from({ length: 30 }, (_, i) => `word${i}xx`).join(" ");
    const terms = tokenizeUserQuery([many]);
    expect(terms.length).toBeLessThanOrEqual(20);
  });

  it("빈/공백 소스 → []", () => {
    expect(tokenizeUserQuery([])).toEqual([]);
    expect(tokenizeUserQuery(["", "   ", "\n"])).toEqual([]);
  });

  it("빈 문자열 term을 절대 방출하지 않음 (requestMatchesQuery 오염 방지)", () => {
    const terms = tokenizeUserQuery(['"" a /  주문서 --- ORD-1']);
    expect(terms.every((t) => t.term.length > 0)).toBe(true);
  });

  it("여러 소스를 결합해 추출 (userPrompt + 콘솔 에러 메시지 등)", () => {
    const terms = tokenizeUserQuery(["주문 목록이 안 떠요", "TypeError: cannot read 'orderStatus'"]);
    expect(values(terms)).toContain("orderstatus");
  });
});
