import { describe, it, expect } from "vitest";

import {
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
