import { describe, it, expect } from "vitest";
import {
  PROP_VALUES,
  valueHintsFor,
  CSS_WIDE_KEYWORDS,
  propertyNameHints,
} from "../propValues";

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

  it("display에 table 계열 값 포함 (셀·행 레벨 편집)", () => {
    expect(PROP_VALUES["display"]).toContain("table");
    expect(PROP_VALUES["display"]).toContain("inline-table");
    expect(PROP_VALUES["display"]).toContain("table-row");
    expect(PROP_VALUES["display"]).toContain("table-cell");
    expect(PROP_VALUES["display"]).toContain("table-caption");
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

describe("propertyNameHints — 코드 뷰 속성명 자동완성 목록", () => {
  it("computed 속성 + 큐레이션(PROP_VALUES 키)을 합쳐 정렬·중복 제거", () => {
    const hints = propertyNameHints(["color", "table-layout", "z-index"]);
    expect(hints).toContain("color");
    expect(hints).toContain("z-index");
    // 큐레이션 키(예: display)는 computed에 없어도 포함
    expect(hints).toContain("display");
    // 정렬됨
    expect([...hints]).toEqual([...hints].sort());
    // 중복 없음
    expect(new Set(hints).size).toBe(hints.length);
  });

  it("tag-prefixed 속성(table-layout)이 목록에 포함 — lang-css 갭 보강", () => {
    expect(propertyNameHints([])).toContain("table-layout");
    expect(propertyNameHints(["table-layout"])).toContain("table-layout");
  });

  it("커스텀 프로퍼티(--*)·빈 값 제외", () => {
    const hints = propertyNameHints(["--tw-ring-color", "", "margin"]);
    expect(hints).not.toContain("--tw-ring-color");
    expect(hints).not.toContain("");
    expect(hints).toContain("margin");
  });

  it("computed가 비어도(비DOM) 큐레이션만으로 동작", () => {
    const hints = propertyNameHints([]);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints).toContain("border-collapse");
  });
});
