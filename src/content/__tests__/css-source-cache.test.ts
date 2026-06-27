import { describe, it, expect } from "vitest";

import { indexCrossOriginRules } from "../css-source-cache";

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
