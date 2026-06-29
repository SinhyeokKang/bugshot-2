import { describe, it, expect } from "vitest";
import {
  isKnownDefault,
  isInactiveBorderColor,
  PROP_CATEGORY,
} from "../propMetadata";

describe("isKnownDefault — border 변별 기본값", () => {
  it("border-{side}-width 0px → 기본값", () => {
    expect(isKnownDefault("border-top-width", "0px")).toBe(true);
    expect(isKnownDefault("border-right-width", "0px")).toBe(true);
    expect(isKnownDefault("border-bottom-width", "0px")).toBe(true);
    expect(isKnownDefault("border-left-width", "0px")).toBe(true);
  });

  it("border-style none → 기본값", () => {
    expect(isKnownDefault("border-style", "none")).toBe(true);
  });

  it("border-{side}-style none → 기본값", () => {
    expect(isKnownDefault("border-top-style", "none")).toBe(true);
    expect(isKnownDefault("border-right-style", "none")).toBe(true);
    expect(isKnownDefault("border-bottom-style", "none")).toBe(true);
    expect(isKnownDefault("border-left-style", "none")).toBe(true);
    expect(isKnownDefault("border-top-style", "solid")).toBe(false);
  });

  it("border-{side}-color 기본 색 → 기본값", () => {
    expect(isKnownDefault("border-bottom-color", "rgb(0, 0, 0)")).toBe(true);
    expect(isKnownDefault("border-top-color", "currentcolor")).toBe(true);
  });

  it("실제 편집값은 기본값 아님", () => {
    expect(isKnownDefault("border-bottom-width", "2px")).toBe(false);
    expect(isKnownDefault("border-style", "dashed")).toBe(false);
    expect(isKnownDefault("border-top-color", "red")).toBe(false);
  });
});

describe("isInactiveBorderColor — 유령 border-color 가드", () => {
  // getComputedStyle은 border가 없어도 border-color를 currentColor resolve값
  // (예 rgb(45, 49, 54) = 글자색)으로 돌려준다. 같은 side의 테두리가 비활성이면
  // (style none 또는 width 0px) 그 색은 의미 없으므로 숨겨야 한다.
  it("border-style none → 비활성(유령색)", () => {
    expect(
      isInactiveBorderColor("border-top-color", {
        "border-top-style": "none",
        "border-top-width": "0px",
        "border-top-color": "rgb(45, 49, 54)",
      }),
    ).toBe(true);
  });

  it("border-width 0px → 비활성 (style이 none이 아니어도)", () => {
    expect(
      isInactiveBorderColor("border-right-color", {
        "border-right-style": "solid",
        "border-right-width": "0px",
        "border-right-color": "rgb(45, 49, 54)",
      }),
    ).toBe(true);
  });

  it("실제 테두리(style solid + width 1px) → 활성(노출 유지)", () => {
    expect(
      isInactiveBorderColor("border-bottom-color", {
        "border-bottom-style": "solid",
        "border-bottom-width": "1px",
        "border-bottom-color": "red",
      }),
    ).toBe(false);
  });

  it("side 독립: top 비활성이어도 bottom 활성은 그대로 노출", () => {
    const cs = {
      "border-top-style": "none",
      "border-top-width": "0px",
      "border-top-color": "rgb(45, 49, 54)",
      "border-bottom-style": "solid",
      "border-bottom-width": "2px",
      "border-bottom-color": "red",
    };
    expect(isInactiveBorderColor("border-top-color", cs)).toBe(true);
    expect(isInactiveBorderColor("border-bottom-color", cs)).toBe(false);
  });

  it("border-color가 아닌 prop은 항상 false", () => {
    expect(isInactiveBorderColor("color", { color: "rgb(45, 49, 54)" })).toBe(false);
    expect(
      isInactiveBorderColor("background-color", {
        "background-color": "rgb(45, 49, 54)",
      }),
    ).toBe(false);
    expect(isInactiveBorderColor("border-top-width", {})).toBe(false);
  });

  it("sibling computed 누락 시 보수적으로 false (판단 불가 → 노출 유지)", () => {
    expect(isInactiveBorderColor("border-left-color", {})).toBe(false);
    expect(
      isInactiveBorderColor("border-left-color", {
        "border-left-color": "rgb(45, 49, 54)",
      }),
    ).toBe(false);
  });
});

describe("PROP_CATEGORY — border 변별 longhand", () => {
  it("width longhand → length", () => {
    expect(PROP_CATEGORY["border-top-width"]).toBe("length");
    expect(PROP_CATEGORY["border-right-width"]).toBe("length");
    expect(PROP_CATEGORY["border-bottom-width"]).toBe("length");
    expect(PROP_CATEGORY["border-left-width"]).toBe("length");
  });

  it("color longhand → color", () => {
    expect(PROP_CATEGORY["border-top-color"]).toBe("color");
    expect(PROP_CATEGORY["border-bottom-color"]).toBe("color");
  });
});

describe("transition — getComputedStyle 유령 기본값 가드", () => {
  // 트랜지션이 없는 요소도 getComputedStyle은 transition-* 4개를 항상 채워 돌려준다.
  it("computed 기본값 → 기본값(섹션 펼침 안 함)", () => {
    expect(isKnownDefault("transition-property", "all")).toBe(true);
    expect(isKnownDefault("transition-duration", "0s")).toBe(true);
    expect(isKnownDefault("transition-timing-function", "ease")).toBe(true);
    expect(isKnownDefault("transition-delay", "0s")).toBe(true);
  });

  it("실제 트랜지션 값은 기본값 아님", () => {
    expect(isKnownDefault("transition-property", "opacity")).toBe(false);
    expect(isKnownDefault("transition-duration", "0.3s")).toBe(false);
    expect(isKnownDefault("transition-timing-function", "ease-in-out")).toBe(false);
    expect(isKnownDefault("transition-delay", "0.1s")).toBe(false);
  });
});

describe("z-index", () => {
  it("PROP_CATEGORY z-index → number (px 미부착)", () => {
    expect(PROP_CATEGORY["z-index"]).toBe("number");
  });

  it("computed 기본값 auto → 기본값", () => {
    expect(isKnownDefault("z-index", "auto")).toBe(true);
  });

  it("실제 편집값(정수)은 기본값 아님", () => {
    expect(isKnownDefault("z-index", "10")).toBe(false);
    expect(isKnownDefault("z-index", "0")).toBe(false);
  });
});
