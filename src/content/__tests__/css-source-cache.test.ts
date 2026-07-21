import { describe, it, expect } from "vitest";

import {
  extractSimpleTokens,
  lastCompound,
  parseStylesheet,
  splitSelectorList,
  indexCrossOriginRules,
  normalizeSelector,
  stripComments,
} from "../css-source-cache";

describe("normalizeSelector — CSSOM 표기 정렬", () => {
  it("top-level 결합자(> + ~) 둘레 간격을 통일", () => {
    expect(normalizeSelector(".a>.b")).toBe(".a > .b");
    expect(normalizeSelector(".a   >.b")).toBe(".a > .b");
    expect(normalizeSelector(".a+.b~.c")).toBe(".a + .b ~ .c");
  });
  it("[]·() 내부의 ~/+는 결합자가 아니라 보존", () => {
    expect(normalizeSelector('[class~="x"]')).toBe('[class~="x"]');
    expect(normalizeSelector(":nth-child(2n+1)")).toBe(":nth-child(2n+1)");
    expect(normalizeSelector('.a>[data-x~="y"]')).toBe('.a > [data-x~="y"]');
  });
  it("이미 정규화된 셀렉터는 동일하게 통과 (raw↔CSSOM 매핑)", () => {
    expect(normalizeSelector(".a > .b")).toBe(".a > .b");
  });
});

describe("stripComments — 문자열 리터럴 보존", () => {
  it("주석만 제거", () => {
    expect(stripComments("a/*c*/b")).toBe("ab");
    expect(stripComments(".x{color:red/* hi */}")).toBe(".x{color:red}");
  });
  it("문자열 안의 /* */는 주석이 아니라 보존", () => {
    expect(stripComments('content:"a/*b*/c"')).toBe('content:"a/*b*/c"');
    expect(stripComments("content:'/* x */'")).toBe("content:'/* x */'");
  });
  it("이스케이프된 따옴표를 문자열 종료로 오인하지 않음", () => {
    expect(stripComments('content:"a\\"/*b*/"')).toBe('content:"a\\"/*b*/"');
  });
});

// parseStylesheet가 뱉는 ParsedRule({selectorText, decls:Map}) 형태를 흉내낸 헬퍼.
function rule(selectorText: string, decls: Record<string, string>) {
  return { selectorText, decls: new Map(Object.entries(decls)) };
}

// cross-origin sheet 원문을 parseStylesheet로 파싱한 ParsedRule[]에 seq를 부여하고,
// :root/전역 * 선택자의 --* 커스텀 프로퍼티를 별도 customProps로 분리 수집한다.
describe("indexCrossOriginRules", () => {
  it("각 rule에 startSeq부터 연속 seq 부여", () => {
    const parsed = [
      rule(".a", { color: "red" }),
      rule(".b", { padding: "8px" }),
    ];
    const { rules } = indexCrossOriginRules(parsed, 0);
    expect(rules.map((r) => r.seq)).toEqual([0, 1]);
  });

  it("startSeq를 이어받는다 (여러 sheet 체인)", () => {
    const parsed = [rule(".a", { color: "red" })];
    const { rules } = indexCrossOriginRules(parsed, 5);
    expect(rules[0].seq).toBe(5);
  });

  it("selectorText·decls를 보존한다", () => {
    const parsed = [rule(".btn", { color: "blue", padding: "4px" })];
    const { rules } = indexCrossOriginRules(parsed, 0);
    expect(rules[0].selectorText).toBe(".btn");
    expect(rules[0].decls.get("color")).toBe("blue");
    expect(rules[0].decls.get("padding")).toBe("4px");
  });

  it(":root의 --* 선언을 customProps로 분리 수집", () => {
    const parsed = [
      rule(":root", { "--brand": "#06c", "--gap": "8px" }),
      rule(".card", { color: "var(--brand)" }),
    ];
    const { customProps } = indexCrossOriginRules(parsed, 0);
    expect(customProps).toEqual({ "--brand": "#06c", "--gap": "8px" });
  });

  it("전역 * 선택자의 --*도 customProps에 수집", () => {
    const parsed = [rule("*", { "--x": "1" })];
    const { customProps } = indexCrossOriginRules(parsed, 0);
    expect(customProps["--x"]).toBe("1");
  });

  it("멀티 셀렉터 한 파트라도 전역(:root)이면 --* 수집", () => {
    const parsed = [rule(":root, [data-theme='dark']", { "--brand": "#06c" })];
    const { customProps } = indexCrossOriginRules(parsed, 0);
    expect(customProps["--brand"]).toBe("#06c");
  });

  it("비전역(스코프) 선택자의 --*는 customProps에 안 들어간다", () => {
    const parsed = [rule(".scoped", { "--local": "9px", color: "red" })];
    const { customProps } = indexCrossOriginRules(parsed, 0);
    expect(customProps["--local"]).toBeUndefined();
  });

  it("빈 입력 → 빈 rules·customProps", () => {
    const { rules, customProps } = indexCrossOriginRules([], 0);
    expect(rules).toEqual([]);
    expect(customProps).toEqual({});
  });
});

// 원본 CSS 미니 파서 — Chrome CSSOM이 shorthand+var()를 빈 값으로 explode하는 걸 우회하는 핵심 경로.
// 지금까지 소비처 테스트가 전부 vi.mock으로 우회해 한 번도 실행되지 않았다 (감사 🟡 항목).
describe("parseStylesheet — 원본 CSS 파싱", () => {
  function parse(css: string) {
    const out: { selectorText: string; decls: Map<string, string> }[] = [];
    parseStylesheet(css, out);
    return out;
  }

  it("단순 규칙의 선택자와 선언을 추출한다", () => {
    const rules = parse(".a { color: red; margin: 0 auto; }");
    expect(rules).toHaveLength(1);
    expect(rules[0].selectorText).toBe(".a");
    expect(rules[0].decls.get("color")).toBe("red");
    expect(rules[0].decls.get("margin")).toBe("0 auto");
  });

  it("중첩 @media 내부의 규칙까지 펼쳐 담는다", () => {
    const rules = parse("@media (min-width: 700px) { .a { color: red; } }");
    expect(rules.map((r) => r.selectorText)).toEqual([".a"]);
  });

  it("@supports·@layer도 내부를 펼친다", () => {
    const rules = parse("@supports (display: grid) { @layer base { .b { gap: 1px; } } }");
    expect(rules.map((r) => r.selectorText)).toEqual([".b"]);
  });

  // @keyframes 내부의 0%/100%는 셀렉터가 아니다 — 규칙으로 새면 매칭이 오염된다.
  it("@keyframes 내부는 규칙으로 담지 않는다", () => {
    const rules = parse("@keyframes spin { from { opacity: 0; } to { opacity: 1; } } .a { color: red; }");
    expect(rules.map((r) => r.selectorText)).toEqual([".a"]);
  });

  it("@import 같은 세미콜론 at-rule을 건너뛴다", () => {
    const rules = parse('@import url("x.css"); .a { color: red; }');
    expect(rules.map((r) => r.selectorText)).toEqual([".a"]);
  });

  it("주석 안의 중괄호에 속지 않는다", () => {
    const rules = parse("/* .fake { color: blue; } */ .a { color: red; }");
    expect(rules.map((r) => r.selectorText)).toEqual([".a"]);
  });

  it("문자열 리터럴 안의 중괄호를 블록 경계로 오인하지 않는다", () => {
    const rules = parse('.a { content: "}"; color: red; }');
    expect(rules).toHaveLength(1);
    expect(rules[0].decls.get("color")).toBe("red");
  });

  it("!important를 값에서 벗겨낸다", () => {
    const rules = parse(".a { color: red !important; }");
    expect(rules[0].decls.get("color")).toBe("red");
  });

  it("닫히지 않은 블록에서 무한 루프 없이 멈춘다", () => {
    expect(() => parse(".a { color: red;")).not.toThrow();
  });
});

describe("splitSelectorList — 셀렉터 목록 분리", () => {
  it("최상위 콤마로 나눈다", () => {
    expect(splitSelectorList(".a, .b , .c")).toEqual([".a", ".b", ".c"]);
  });

  // :not(.x, .y)의 콤마로 쪼개면 존재하지 않는 셀렉터가 생긴다.
  it("괄호 안의 콤마는 경계가 아니다", () => {
    expect(splitSelectorList(":not(.x, .y), .b")).toEqual([":not(.x, .y)", ".b"]);
  });

  it("속성 셀렉터 안의 콤마도 보호한다", () => {
    expect(splitSelectorList('[data-x="a,b"], .c')).toEqual(['[data-x="a,b"]', ".c"]);
  });

  it("빈 문자열은 빈 배열", () => {
    expect(splitSelectorList("")).toEqual([]);
  });
});

describe("lastCompound — 마지막 compound 추출", () => {
  it("자손 결합자 뒤 마지막 조각을 고른다", () => {
    expect(lastCompound("div .a")).toBe(".a");
  });

  it("자식·인접 결합자도 경계로 본다", () => {
    expect(lastCompound("div > .a")).toBe(".a");
    expect(lastCompound("div + .a")).toBe(".a");
    expect(lastCompound("div ~ .a")).toBe(".a");
  });

  it("괄호 안의 공백은 경계가 아니다", () => {
    expect(lastCompound(":not(.x .y)")).toBe(":not(.x .y)");
  });

  it("결합자가 없으면 전체가 마지막 compound", () => {
    expect(lastCompound(".a.b")).toBe(".a.b");
  });
});

describe("extractSimpleTokens — compound 토큰 분해", () => {
  it("태그·클래스·id를 분리한다", () => {
    const t = extractSimpleTokens("div.a.b#c");
    expect(t.tag).toBe("div");
    expect(t.classes).toEqual(["a", "b"]);
    expect(t.ids).toEqual(["c"]);
    expect(t.any).toBe(false);
  });

  it("태그명을 소문자로 정규화한다", () => {
    expect(extractSimpleTokens("DIV").tag).toBe("div");
  });

  it("의사클래스는 건너뛰고 앞쪽 토큰을 유지한다", () => {
    const t = extractSimpleTokens(".a:hover");
    expect(t.classes).toEqual(["a"]);
    expect(t.any).toBe(false);
  });

  it("인자 있는 의사클래스도 통째로 건너뛴다", () => {
    const t = extractSimpleTokens(".a:not(.x)");
    expect(t.classes).toEqual(["a"]);
    expect(t.any).toBe(false);
  });

  it("속성 셀렉터를 건너뛴다", () => {
    const t = extractSimpleTokens('.a[data-x="y"]');
    expect(t.classes).toEqual(["a"]);
    expect(t.any).toBe(false);
  });

  // any=true는 "인덱스로 못 거르니 전부 후보"라는 뜻 — 놓치는 것보다 넓게 잡는 쪽이 안전하다.
  it("빈 compound는 any로 표시한다", () => {
    expect(extractSimpleTokens("").any).toBe(true);
  });

  it("* 는 토큰 없이 통과한다", () => {
    const t = extractSimpleTokens("*");
    expect(t.any).toBe(false);
    expect(t.classes).toEqual([]);
  });

  it("해석 불가한 문자가 나오면 any로 넘긴다", () => {
    expect(extractSimpleTokens("%bogus").any).toBe(true);
  });
});
