import { describe, it, expect } from "vitest";
import { PROP_VALUES, valueHintsFor, CSS_WIDE_KEYWORDS } from "../propValues";

describe("PROP_VALUES — 열거형 속성 값 단일 출처", () => {
  it("테이블 속성 값 커버", () => {
    expect(PROP_VALUES["table-layout"]).toEqual(["auto", "fixed"]);
    expect(PROP_VALUES["border-collapse"]).toEqual(["separate", "collapse"]);
    expect(PROP_VALUES["caption-side"]).toEqual(["top", "bottom"]);
    expect(PROP_VALUES["empty-cells"]).toEqual(["show", "hide"]);
    expect(PROP_VALUES["vertical-align"]).toContain("middle");
    expect(PROP_VALUES["vertical-align"]).toContain("baseline");
  });

  it("기존 폼 열거 속성도 커버 (전 속성 공통 갭 해소)", () => {
    expect(PROP_VALUES["overflow"]).toEqual([
      "visible",
      "hidden",
      "scroll",
      "auto",
      "clip",
    ]);
    expect(PROP_VALUES["display"]).toContain("flex");
    expect(PROP_VALUES["position"]).toContain("sticky");
    expect(PROP_VALUES["white-space"]).toContain("nowrap");
  });

  it("CSS-wide 키워드 상수", () => {
    expect(CSS_WIDE_KEYWORDS).toEqual(["initial", "inherit", "unset", "revert"]);
  });
});

describe("valueHintsFor — property-aware 값 제안", () => {
  it("열거 속성 → 그 속성의 값 + CSS-wide 키워드", () => {
    const hints = valueHintsFor("border-collapse");
    expect(hints).not.toBeNull();
    expect(hints).toContain("separate");
    expect(hints).toContain("collapse");
    expect(hints).toContain("inherit");
  });

  it("overflow → scroll/hidden 포함 (기존 generic 갭에서 누락됐던 값)", () => {
    const hints = valueHintsFor("overflow");
    expect(hints).toContain("scroll");
    expect(hints).toContain("hidden");
    expect(hints).toContain("clip");
  });

  it("속성 고유 값이 CSS-wide보다 앞에 온다", () => {
    const hints = valueHintsFor("table-layout")!;
    expect(hints.indexOf("fixed")).toBeLessThan(hints.indexOf("inherit"));
  });

  it("열거형이 아닌 속성(color·width 등) → null (generic 폴백)", () => {
    expect(valueHintsFor("color")).toBeNull();
    expect(valueHintsFor("width")).toBeNull();
    expect(valueHintsFor("margin-top")).toBeNull();
  });

  it("빈/미지 속성 → null", () => {
    expect(valueHintsFor("")).toBeNull();
    expect(valueHintsFor("nonexistent-prop")).toBeNull();
  });
});
