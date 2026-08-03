import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 수용 테스트가 테스트별로 규칙을 갈아끼울 수 있게 hoisted mutable로 둔다(vi.mock hoisting 제약).
const mockRules = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("../css-source-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../css-source-cache")>();
  return {
    // splitSelectorList 등 순수 헬퍼는 실제 구현을 쓴다 — 모듈 통째 mock이라 빠지면
    // matchedSpecificity가 undefined를 호출한다.
    ...actual,
    getMatchingRules: () => mockRules.current as CSSStyleRule[],
    getRawDeclarationsFor: () => null,
    flattenSheets: (sheets: unknown[]) => sheets,
    getMatchingCrossOriginRules: () => [],
    getMatchingCrossOriginCustomPropRules: () => [],
    getCrossOriginCustomProps: () => ({}),
  };
});

import {
  resolveVarChain,
  INTERESTING_PROPS,
  categorizeToken,
  tokenizeEditableText,
  classifyEditableChildren,
  readEditableText,
  writeEditableText,
  shouldRestoreEditable,
  splitTrblValue,
  splitCssTokens,
  hydrateReferencedCustomProps,
  collectReferencedTokenNames,
  mergeCrossOriginDecls,
  mergeCrossOriginTokens,
  parseBorderShorthand,
  expandShorthands,
  extractVarPropsFromMap,
  shouldOverwriteSpecified,
  newClaimState,
  noteClaim,
  resolveUncertainSpecified,
  normalizePositionOffsets,
  resolveTokenValue,
  selectorSpecificity,
  compareSpecificity,
  matchedSpecificity,
  hasOpaqueCascadeContext,
  collectSpecifiedStylesWithSources,
  type EditableHandle,
} from "../css-resolve";

describe("categorizeToken", () => {
  it("hex·함수형·named color → color", () => {
    expect(categorizeToken("#abc")).toBe("color");
    expect(categorizeToken("rgb(0,0,0)")).toBe("color");
    expect(categorizeToken("transparent")).toBe("color");
  });
  it("CSS named color → color (대소문자 무관)", () => {
    expect(categorizeToken("tomato")).toBe("color");
    expect(categorizeToken("rebeccapurple")).toBe("color");
    expect(categorizeToken("RED")).toBe("color");
  });
  it("단위 길이·unitless 0 → length", () => {
    expect(categorizeToken("16px")).toBe("length");
    expect(categorizeToken("1.5rem")).toBe("length");
    expect(categorizeToken("0")).toBe("length");
    expect(categorizeToken("-0")).toBe("length");
  });
  it("모던/컨테이너 단위(q·svh·dvh·cqw·vi)도 length", () => {
    expect(categorizeToken("2q")).toBe("length");
    expect(categorizeToken("50svh")).toBe("length");
    expect(categorizeToken("100dvh")).toBe("length");
    expect(categorizeToken("10cqw")).toBe("length");
    expect(categorizeToken("5vi")).toBe("length");
  });
  it("길이 단위 포함 calc/clamp/min/max → length", () => {
    expect(categorizeToken("calc(100% - 16px)")).toBe("length");
    expect(categorizeToken("clamp(1rem, 2vw, 3rem)")).toBe("length");
    expect(categorizeToken("min(10px, 5%)")).toBe("length");
  });
  it("unitless 양수(0 제외)는 number", () => {
    expect(categorizeToken("1.5")).toBe("number");
    expect(categorizeToken("400")).toBe("number");
  });
  it("gradient·url → image", () => {
    expect(categorizeToken("linear-gradient(red, blue)")).toBe("image");
    expect(categorizeToken("url(a.png)")).toBe("image");
  });
  it("미상값 → unknown", () => {
    expect(categorizeToken("auto")).toBe("unknown");
    expect(categorizeToken("")).toBe("unknown");
  });
});

describe("INTERESTING_PROPS", () => {
  it("주요 CSS 속성 포함", () => {
    expect(INTERESTING_PROPS).toContain("color");
    expect(INTERESTING_PROPS).toContain("font-size");
    expect(INTERESTING_PROPS).toContain("padding-top");
    expect(INTERESTING_PROPS).toContain("border-radius");
    expect(INTERESTING_PROPS).toContain("display");
  });

  it("border 변별 longhand + border-style 포함", () => {
    expect(INTERESTING_PROPS).toContain("border-style");
    expect(INTERESTING_PROPS).toContain("border-bottom-width");
    expect(INTERESTING_PROPS).toContain("border-bottom-color");
  });

  it("border-*-style per-side longhand 포함", () => {
    expect(INTERESTING_PROPS).toContain("border-top-style");
    expect(INTERESTING_PROPS).toContain("border-right-style");
    expect(INTERESTING_PROPS).toContain("border-bottom-style");
    expect(INTERESTING_PROPS).toContain("border-left-style");
  });

  it("z-index 포함 (수집 화이트리스트)", () => {
    expect(INTERESTING_PROPS).toContain("z-index");
  });

  it("테이블 속성 포함 (before 캡처 + CSS 뷰 seed)", () => {
    expect(INTERESTING_PROPS).toContain("table-layout");
    expect(INTERESTING_PROPS).toContain("border-collapse");
    expect(INTERESTING_PROPS).toContain("border-spacing");
    expect(INTERESTING_PROPS).toContain("caption-side");
    expect(INTERESTING_PROPS).toContain("empty-cells");
    expect(INTERESTING_PROPS).toContain("vertical-align");
  });

  it("충분한 수의 속성", () => {
    expect(INTERESTING_PROPS.length).toBeGreaterThanOrEqual(30);
  });

  // var()가 낀 `transition`은 CSSOM longhand가 전부 빈 문자열이라(Chrome 실측) longhand
  // 4개만으로는 author 값이 통째 누락된다 — shorthand 자체를 수집해 값·토큰을 살린다.
  it("transition shorthand 포함", () => {
    expect(INTERESTING_PROPS).toContain("transition");
  });
});

describe("splitCssTokens — 괄호 depth-aware 분해", () => {
  it("공백 구분 토큰 분해", () => {
    expect(splitCssTokens("red blue")).toEqual(["red", "blue"]);
  });

  it("색 함수 내부 공백/콤마는 1토큰으로 보존", () => {
    expect(splitCssTokens("rgb(1, 2, 3)")).toEqual(["rgb(1, 2, 3)"]);
    expect(splitCssTokens("hsl(var(--border))")).toEqual([
      "hsl(var(--border))",
    ]);
    expect(splitCssTokens("1px solid rgb(0, 0, 0)")).toEqual([
      "1px",
      "solid",
      "rgb(0, 0, 0)",
    ]);
  });
});

describe("splitTrblValue — border-width/color shorthand 분해", () => {
  it("단일 값 → 네 변 동일", () => {
    expect(splitTrblValue("1px")).toEqual(["1px", "1px", "1px", "1px"]);
  });

  it("2값 → top/bottom, right/left", () => {
    expect(splitTrblValue("red blue")).toEqual(["red", "blue", "red", "blue"]);
  });

  it("색 함수(var 포함)는 1토큰 보존하며 네 변에 분배", () => {
    const v = "hsl(var(--border))";
    expect(splitTrblValue(v)).toEqual([v, v, v, v]);
  });

  it("4값 → top right bottom left", () => {
    expect(splitTrblValue("1px 2px 3px 4px")).toEqual([
      "1px",
      "2px",
      "3px",
      "4px",
    ]);
  });

  it("슬래시(radius elliptical) 포함 → null (분해 안 함)", () => {
    expect(splitTrblValue("10px / 20px")).toBeNull();
  });

  it("border-style 키워드 TRBL 분해 (2값 → top/bottom·right/left)", () => {
    expect(splitTrblValue("solid dashed")).toEqual([
      "solid",
      "dashed",
      "solid",
      "dashed",
    ]);
  });

  it("border-style 키워드 단일 값 → 네 변 동일", () => {
    expect(splitTrblValue("dotted")).toEqual([
      "dotted",
      "dotted",
      "dotted",
      "dotted",
    ]);
  });
});

describe("parseBorderShorthand — width|style|color 분류", () => {
  it("1px solid var(--c): var는 color로 (테마 토큰 보존)", () => {
    expect(parseBorderShorthand("1px solid var(--color-stroke)")).toEqual({
      width: "1px",
      style: "solid",
      color: "var(--color-stroke)",
    });
  });

  it("순서 무관 + 색 함수 1토큰 보존", () => {
    expect(parseBorderShorthand("dashed rgb(0, 0, 0) 2px")).toEqual({
      width: "2px",
      style: "dashed",
      color: "rgb(0, 0, 0)",
    });
  });

  it("thin/thick 키워드 width", () => {
    expect(parseBorderShorthand("thin solid #f00")).toEqual({
      width: "thin",
      style: "solid",
      color: "#f00",
    });
  });

  it("색만/스타일만 부분 지정", () => {
    expect(parseBorderShorthand("red")).toEqual({ color: "red" });
    expect(parseBorderShorthand("none")).toEqual({ style: "none" });
    expect(parseBorderShorthand("1px solid")).toEqual({
      width: "1px",
      style: "solid",
    });
  });
});

describe("expandShorthands — border shorthand 전개", () => {
  it("border: 1px solid var(--c) → 네 변 변별 longhand (naver border-color 회귀)", () => {
    const all: Record<string, string> = {
      border: "1px solid var(--color-neutral-stroke-subtle-2)",
    };
    const sources: Record<string, string> = { border: ".btn" };
    expandShorthands(all, sources);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(all[`border-${side}-color`]).toBe(
        "var(--color-neutral-stroke-subtle-2)",
      );
      expect(all[`border-${side}-width`]).toBe("1px");
      expect(all[`border-${side}-style`]).toBe("solid");
      expect(sources[`border-${side}-color`]).toBe(".btn");
    }
  });

  it("기존 longhand는 border가 안 덮음 (fill-if-absent)", () => {
    const all: Record<string, string> = {
      border: "1px solid red",
      "border-top-color": "var(--accent)",
    };
    expandShorthands(all, {});
    expect(all["border-top-color"]).toBe("var(--accent)");
    expect(all["border-bottom-color"]).toBe("red");
  });

  it("per-side border-bottom shorthand는 해당 변만 전개", () => {
    const all: Record<string, string> = {
      "border-bottom": "2px dashed var(--c)",
    };
    expandShorthands(all, {});
    expect(all["border-bottom-color"]).toBe("var(--c)");
    expect(all["border-top-color"]).toBeUndefined();
  });

  it("per-side(구체)가 border(전체)보다 우선", () => {
    const all: Record<string, string> = {
      border: "1px solid red",
      "border-top": "2px solid var(--accent)",
    };
    expandShorthands(all, {});
    expect(all["border-top-color"]).toBe("var(--accent)");
    expect(all["border-right-color"]).toBe("red");
  });

  it("inset 단축 → top/right/bottom/left TRBL 전개", () => {
    const all: Record<string, string> = { inset: "16px 24px" };
    const sources: Record<string, string> = { inset: ".box" };
    expandShorthands(all, sources);
    expect(all.top).toBe("16px");
    expect(all.right).toBe("24px");
    expect(all.bottom).toBe("16px");
    expect(all.left).toBe("24px");
    expect(sources.top).toBe(".box");
  });

  it("inset 단축은 기존 longhand를 안 덮음 (fill-if-absent)", () => {
    const all: Record<string, string> = { inset: "0px", top: "10px" };
    expandShorthands(all, {});
    expect(all.top).toBe("10px");
    expect(all.bottom).toBe("0px");
  });
});

describe("expandShorthands — background shorthand → background-color 가드", () => {
  it("단색 background는 background-color로 전개", () => {
    const all: Record<string, string> = { background: "#fff" };
    const sources: Record<string, string> = { background: ".hero" };
    expandShorthands(all, sources);
    expect(all["background-color"]).toBe("#fff");
    expect(sources["background-color"]).toBe(".hero");
  });

  it("named color / 단일 var background도 전개(토큰 보존)", () => {
    const a: Record<string, string> = { background: "red" };
    expandShorthands(a, {});
    expect(a["background-color"]).toBe("red");
    const b: Record<string, string> = { background: "var(--surface)" };
    expandShorthands(b, {});
    expect(b["background-color"]).toBe("var(--surface)");
  });

  it("이미지/다중 레이어 background는 background-color를 오염시키지 않음", () => {
    const img: Record<string, string> = {
      background: "#fff url(bg.png) no-repeat",
    };
    expandShorthands(img, {});
    expect(img["background-color"]).toBeUndefined();
    const grad: Record<string, string> = {
      background: "linear-gradient(#fff, #000)",
    };
    expandShorthands(grad, {});
    expect(grad["background-color"]).toBeUndefined();
  });

  it("기존 background-color longhand는 background가 안 덮음", () => {
    const all: Record<string, string> = {
      background: "#fff",
      "background-color": "var(--bg)",
    };
    expandShorthands(all, {});
    expect(all["background-color"]).toBe("var(--bg)");
  });
});

// var()가 낀 shorthand는 Chrome CSSOM이 longhand를 전부 빈 문자열로 돌려주므로(실측)
// 이 수동 전개가 유일한 출처가 된다 — 2값 shorthand를 통째 복사하면 longhand가 오염된다.
// longhand 이름·순서의 단일 출처는 SHORTHAND_MAP이고, TRBL/PAIR는 값을 몇 조각으로
// 쪼갤지만 정한다. 이 표는 세 가지를 한꺼번에 고정한다 — arity 불일치(자리 하나가
// undefined로 샘), SHORTHAND_MAP 내부 순서(논리 속성 LTR 매핑 역전), split 테이블 등록
// 누락(둘 중 어디에도 없으면 splitShorthandValue가 null → 조용한 무전개).
describe("shorthand 테이블 정합성", () => {
  const CASES: Array<[string, string[]]> = [
    ["padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
    ["margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
    ["inset", ["top", "right", "bottom", "left"]],
    ["border-radius", [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ]],
    ["border-width", [
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width",
    ]],
    ["border-color", [
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color",
    ]],
    ["gap", ["row-gap", "column-gap"]],
    ["overflow", ["overflow-x", "overflow-y"]],
    ["padding-inline", ["padding-left", "padding-right"]],
    ["padding-block", ["padding-top", "padding-bottom"]],
    ["margin-inline", ["margin-left", "margin-right"]],
    ["margin-block", ["margin-top", "margin-bottom"]],
    ["inset-inline", ["left", "right"]],
    ["inset-block", ["top", "bottom"]],
  ];

  it.each(CASES)("%s는 선언 순서대로 각 longhand에 배분된다", (shorthand, longhands) => {
    const value = longhands.map((_, i) => `${i + 1}px`).join(" ");
    const all: Record<string, string> = { [shorthand]: value };
    expandShorthands(all, {});
    longhands.forEach((lh, i) => {
      expect(all[lh]).toBe(`${i + 1}px`);
    });
  });

  it("전개된 자리에 undefined가 새지 않는다", () => {
    for (const [shorthand, value] of [
      ["padding", "1px 2px 3px 4px"],
      ["gap", "1px 2px"],
      ["inset-inline", "1px 2px"],
      ["overflow", "hidden auto"],
      ["border-radius", "1px 2px 3px 4px"],
    ] as const) {
      const all: Record<string, string> = { [shorthand]: value };
      expandShorthands(all, {});
      expect(Object.values(all).every((v) => typeof v === "string")).toBe(true);
    }
  });
});

describe("expandShorthands — 2값 shorthand 분해", () => {
  it("gap 2값 → row-gap/column-gap 분리", () => {
    const all: Record<string, string> = { gap: "var(--gy) var(--gx)" };
    const sources: Record<string, string> = { gap: ".grid" };
    expandShorthands(all, sources);
    expect(all["row-gap"]).toBe("var(--gy)");
    expect(all["column-gap"]).toBe("var(--gx)");
    expect(sources["row-gap"]).toBe(".grid");
  });

  it("gap 1값 → 두 축 모두 같은 값", () => {
    const all: Record<string, string> = { gap: "8px" };
    expandShorthands(all, {});
    expect(all["row-gap"]).toBe("8px");
    expect(all["column-gap"]).toBe("8px");
  });

  it("overflow 2값 → overflow-x/overflow-y 분리", () => {
    const all: Record<string, string> = { overflow: "hidden var(--oy)" };
    expandShorthands(all, {});
    expect(all["overflow-x"]).toBe("hidden");
    expect(all["overflow-y"]).toBe("var(--oy)");
  });

  // 논리 속성은 var()가 없어도 Chrome이 물리 longhand로 explode하지 않는다(실측) —
  // 항상 이 경로만 남으므로 2값 오염이 상시 발동한다.
  it("padding-inline 2값 → padding-left/right 분리 (var 없어도)", () => {
    const all: Record<string, string> = { "padding-inline": "4px 8px" };
    expandShorthands(all, {});
    expect(all["padding-left"]).toBe("4px");
    expect(all["padding-right"]).toBe("8px");
  });

  it("margin-block 2값 → margin-top/bottom 분리", () => {
    const all: Record<string, string> = { "margin-block": "var(--a) var(--b)" };
    expandShorthands(all, {});
    expect(all["margin-top"]).toBe("var(--a)");
    expect(all["margin-bottom"]).toBe("var(--b)");
  });

  it("inset-inline/inset-block → 물리 오프셋 분리", () => {
    const all: Record<string, string> = {
      "inset-inline": "var(--l) 8px",
      "inset-block": "4px",
    };
    expandShorthands(all, {});
    expect(all.left).toBe("var(--l)");
    expect(all.right).toBe("8px");
    expect(all.top).toBe("4px");
    expect(all.bottom).toBe("4px");
  });

  it("논리 속성 1값 → 두 변 모두 같은 값", () => {
    const all: Record<string, string> = { "padding-inline": "var(--p)" };
    expandShorthands(all, {});
    expect(all["padding-left"]).toBe("var(--p)");
    expect(all["padding-right"]).toBe("var(--p)");
  });

  it("2값 shorthand도 기존 longhand는 안 덮음 (fill-if-absent)", () => {
    const all: Record<string, string> = {
      gap: "4px 8px",
      "row-gap": "var(--gy)",
    };
    expandShorthands(all, {});
    expect(all["row-gap"]).toBe("var(--gy)");
    expect(all["column-gap"]).toBe("8px");
  });
});

// 문법이 복합·가변인 shorthand(font·transition·elliptical radius)는 토큰 위치를 신뢰할 수
// 없다 — 값을 통째 복사하면 longhand가 쓰레기 문자열로 오염된다. 누락이 오염보다 낫다.
describe("expandShorthands — 파싱 불가 shorthand는 longhand 미오염", () => {
  it("font shorthand는 longhand를 채우지 않음", () => {
    const all: Record<string, string> = { font: "bold var(--fs)/1.5 Arial" };
    expandShorthands(all, {});
    expect(all["font-size"]).toBeUndefined();
    expect(all["font-family"]).toBeUndefined();
    expect(all["font-weight"]).toBeUndefined();
    expect(all["line-height"]).toBeUndefined();
    expect(all["letter-spacing"]).toBeUndefined();
  });

  it("transition shorthand는 longhand를 채우지 않음", () => {
    const all: Record<string, string> = { transition: "all var(--dur) ease" };
    expandShorthands(all, {});
    expect(all["transition-property"]).toBeUndefined();
    expect(all["transition-duration"]).toBeUndefined();
    expect(all["transition-timing-function"]).toBeUndefined();
    expect(all["transition-delay"]).toBeUndefined();
  });

  // `/` 검사가 문자열 전체를 훑으면 calc 안의 나눗셈까지 전개를 막아, author가 쓴 값이
  // 통째로 사라지고 소비처가 computed px로 폴백한다.
  it("calc 안의 나눗셈은 전개를 막지 않음", () => {
    const all: Record<string, string> = { padding: "calc(100% / 3)" };
    expandShorthands(all, {});
    expect(all["padding-top"]).toBe("calc(100% / 3)");
    expect(all["padding-left"]).toBe("calc(100% / 3)");

    const gap: Record<string, string> = { gap: "calc(var(--gutter) / 2)" };
    expandShorthands(gap, {});
    expect(gap["row-gap"]).toBe("calc(var(--gutter) / 2)");
    expect(gap["column-gap"]).toBe("calc(var(--gutter) / 2)");
  });

  it("elliptical border-radius(`/`)는 코너를 채우지 않음", () => {
    const all: Record<string, string> = { "border-radius": "var(--r) / 20px" };
    expandShorthands(all, {});
    expect(all["border-top-left-radius"]).toBeUndefined();
    expect(all["border-bottom-right-radius"]).toBeUndefined();
  });

  it("5토큰 이상 TRBL 값도 채우지 않음", () => {
    const all: Record<string, string> = { padding: "1px 2px 3px 4px 5px" };
    expandShorthands(all, {});
    expect(all["padding-top"]).toBeUndefined();
  });
});

// 규칙 순회 중(순서를 아는 유일한 지점) border shorthand가 앞선 규칙이 채운 longhand의
// 소유권을 가져와야 한다. expandShorthands는 flat map이라 순서를 복원할 수 없다.
describe("extractVarPropsFromMap — border shorthand longhand 소유권", () => {
  it("앞선 리셋(`*{border:0}`)이 채운 비-var longhand를 덮는다", () => {
    // Chrome CSSOM은 `border: 0` 규칙을 0px/none/currentcolor로 explode한다(실측).
    const out: Record<string, string> = {};
    const sources: Record<string, string> = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      out[`border-${side}-width`] = "0px";
      out[`border-${side}-style`] = "none";
      out[`border-${side}-color`] = "currentcolor";
      sources[`border-${side}-width`] = "*";
    }
    extractVarPropsFromMap(
      new Map([["border", "0.1rem solid var(--divider)"]]),
      out,
      sources,
      {},
      ".card",
    );
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(out[`border-${side}-width`]).toBe("0.1rem");
      expect(out[`border-${side}-style`]).toBe("solid");
      expect(out[`border-${side}-color`]).toBe("var(--divider)");
      expect(sources[`border-${side}-width`]).toBe(".card");
    }
    expect(out.border).toBe("0.1rem solid var(--divider)");
  });

  // 토큰 강등 방지는 var()→리터럴 방향에만 걸린다. var()→var()는 뒤 규칙이 이겨야
  // 한다 — 앞선 토큰을 동결하면 `.card` + `.card--danger`처럼 두 규칙이 각각 토큰
  // border를 선언할 때 축마다 출처가 갈려 자기모순이 된다.
  it("앞선 var() longhand는 나중 shorthand의 var()에 자리를 내준다", () => {
    const out: Record<string, string> = {
      "border-top-color": "var(--accent)",
      "border-top-width": "0px",
    };
    extractVarPropsFromMap(
      new Map([["border", "1px solid var(--divider)"]]),
      out,
      {},
      {},
      ".card",
    );
    expect(out["border-top-color"]).toBe("var(--divider)");
    expect(out["border-top-width"]).toBe("1px");
  });

  it("var() 토큰은 나중 리터럴로 강등되지 않는다", () => {
    expect(shouldOverwriteSpecified("var(--accent)", "#333", false)).toBe(false);
  });

  it("border-{side} shorthand는 해당 변만 덮는다", () => {
    const out: Record<string, string> = {
      "border-top-color": "currentcolor",
      "border-left-color": "currentcolor",
    };
    extractVarPropsFromMap(
      new Map([["border-top", "2px dashed var(--c)"]]),
      out,
      {},
      {},
      ".card",
    );
    expect(out["border-top-color"]).toBe("var(--c)");
    expect(out["border-left-color"]).toBe("currentcolor");
  });

  it("같은 규칙에 명시된 longhand가 border shorthand보다 우선", () => {
    const out: Record<string, string> = {};
    extractVarPropsFromMap(
      new Map([
        ["border", "1px solid var(--divider)"],
        ["border-top-color", "var(--accent)"],
      ]),
      out,
      {},
      {},
      ".card",
    );
    expect(out["border-top-color"]).toBe("var(--accent)");
    expect(out["border-right-color"]).toBe("var(--divider)");
  });

  // 같은 규칙 안에선 뒤에 선언된 쪽이 이긴다 — 앞선 축에 양보하면 토큰을 잃는다.
  it("border shorthand보다 앞에 선언된 축은 덮는다", () => {
    const out: Record<string, string> = {};
    extractVarPropsFromMap(
      new Map([
        ["border-color", "#ddd"],
        ["border", "1px solid var(--divider)"],
      ]),
      out,
      {},
      {},
      ".card",
    );
    expect(out["border-top-color"]).toBe("var(--divider)");
  });

  // 4면 요약 키는 INTERESTING_PROPS에 실려 그대로 노출되므로(border-style), per-side만
  // 덮으면 리셋이 남긴 요약과 모순된 채 나간다.
  it("4면 요약 키(border-style)도 함께 덮는다", () => {
    const out: Record<string, string> = {
      "border-style": "none",
      "border-top-style": "none",
    };
    extractVarPropsFromMap(
      new Map([["border", "1px solid var(--divider)"]]),
      out,
      {},
      {},
      ".card",
    );
    expect(out["border-style"]).toBe("solid");
    expect(out["border-top-style"]).toBe("solid");
  });

  it("border-{side} shorthand는 4면 요약 키를 건드리지 않는다", () => {
    const out: Record<string, string> = { "border-style": "none" };
    extractVarPropsFromMap(
      new Map([["border-top", "1px solid var(--c)"]]),
      out,
      {},
      {},
      ".card",
    );
    expect(out["border-style"]).toBe("none");
    expect(out["border-top-style"]).toBe("solid");
  });

  it("wantedProps 필터를 존중한다 (inspector 경로)", () => {
    const out: Record<string, string> = {};
    extractVarPropsFromMap(
      new Map([["border", "1px solid var(--divider)"]]),
      out,
      {},
      {},
      ".card",
      new Set(["color"]),
    );
    expect(out["border-top-color"]).toBeUndefined();
    expect(out.border).toBeUndefined();
  });
});

// border shorthand 전개는 "앞선 리셋을 밀어낸다"가 목적인데, 중요도·후속 직접 선언을
// 모르면 "앞뒤 무관하게 항상 이긴다"가 되어 실제 캐스케이드와 어긋난다.
describe("extractVarPropsFromMap — 중요도·파생 표시", () => {
  it("!important로 확정된 축은 border shorthand가 덮지 않는다", () => {
    const claims = newClaimState();
    claims.important.add("border-top-color");
    const out: Record<string, string> = { "border-top-color": "red" };
    extractVarPropsFromMap(
      new Map([["border", "1px solid var(--c)"]]),
      out,
      {},
      {},
      ".b",
      undefined,
      claims,
    );
    expect(out["border-top-color"]).toBe("red");
    expect(out["border-top-width"]).toBe("1px");
  });

  // 같은 중요도끼리는 문서 순서상 뒤가 이긴다 — important를 "영구 잠금"으로 다루면
  // 나중 규칙의 !important shorthand가 앞선 !important longhand에 진다.
  it("현재 규칙도 !important면 앞선 !important를 이긴다", () => {
    const claims = newClaimState();
    claims.important.add("border-top-color");
    const out: Record<string, string> = { "border-top-color": "red" };
    extractVarPropsFromMap(
      new Map([["border", "1px solid var(--c)"]]),
      out,
      {},
      {},
      ".b",
      undefined,
      claims,
      new Set(["border-top-color"]),
    );
    expect(out["border-top-color"]).toBe("var(--c)");
  });

  it("shorthand가 채운 축은 파생으로 표시된다", () => {
    const claims = newClaimState();
    extractVarPropsFromMap(
      new Map([["border", "1px solid var(--c)"]]),
      {},
      {},
      {},
      ".c1",
      undefined,
      claims,
    );
    expect(claims.derived.has("border-top-color")).toBe(true);
    expect(claims.derived.has("border-style")).toBe(true);
  });

  // `border: var(--bd)`처럼 축을 알 수 없는 값은 color 슬롯에 통째로 들어가면 안 된다.
  it("단일 var()/CSS-wide 키워드는 슬롯 배정을 포기한다", () => {
    expect(parseBorderShorthand("var(--bd)")).toEqual({});
    expect(parseBorderShorthand("inherit")).toEqual({});
    expect(parseBorderShorthand("unset")).toEqual({});
    // 축이 분명한 단일 토큰은 그대로 분류.
    expect(parseBorderShorthand("red")).toEqual({ color: "red" });
    expect(parseBorderShorthand("none")).toEqual({ style: "none" });
  });

  it("축을 모르는 shorthand 토큰은 앞선 값을 오염시키지 않는다", () => {
    const out: Record<string, string> = {
      "border-top-color": "currentcolor",
      "border-top-width": "0px",
    };
    extractVarPropsFromMap(
      new Map([["border", "var(--bd)"]]),
      out,
      {},
      {},
      ".card",
    );
    expect(out["border-top-color"]).toBe("currentcolor");
    expect(out["border-top-width"]).toBe("0px");
  });
});

// 규칙 순회에서 specified를 덮을지 판정하는 단일 출처. author가 직접 쓴 var()는 보호하되,
// shorthand에서 파생된 값은 뒤 규칙의 직접 선언(리터럴 포함)에 자리를 내줘야 한다.
describe("noteClaim", () => {
  it("확정된 important winner를 뒤의 일반 선언이 uncertain으로 강등하지 않음", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", true, "#target");
    noteClaim(claims, "color", "blue", false, ".target");
    noteClaim(claims, "color", "green", false, "div");

    expect(claims.candidates.get("color")?.value).toBe("red");
    expect(claims.uncertain.has("color")).toBe(false);
  });

  it("동일 값 inline winner가 기존 ambiguity를 해소", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a");
    noteClaim(claims, "color", "blue", false, ".b");
    noteClaim(claims, "color", "blue", false, "[inline]");

    expect(claims.candidates.get("color")?.origin).toBe("[inline]");
    expect(claims.uncertain.has("color")).toBe(false);
  });

  it("동일 값 important 선언이 winner metadata를 승격", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "blue", false, ".a");
    noteClaim(claims, "color", "blue", true, ".b");
    noteClaim(claims, "color", "green", false, ".c");

    expect(claims.candidates.get("color")?.important).toBe(true);
    expect(claims.uncertain.has("color")).toBe(false);
  });
});

// 규칙 둘이 같은 prop을 다르게 선언하면(specificity를 모르므로) computed로 회피하는데,
// author가 토큰을 썼으면 이름을 잃어선 안 된다 — computed는 var()를 이미 해석해 버린다.
describe("resolveUncertainSpecified", () => {
  it("var() 토큰은 computed로 강등하지 않는다", () => {
    const all: Record<string, string> = { color: "var(--fg)" };
    const sources: Record<string, string> = { color: ".theme a" };
    resolveUncertainSpecified(all, sources, new Set(["color"]), () => "rgb(51, 51, 51)");
    expect(all.color).toBe("var(--fg)");
    expect(sources.color).toBe(".theme a");
  });

  it("리터럴끼리 충돌하면 computed로 회피한다", () => {
    const all: Record<string, string> = { color: "#333" };
    const sources: Record<string, string> = { color: "a" };
    resolveUncertainSpecified(all, sources, new Set(["color"]), () => "rgb(0, 102, 204)");
    expect(all.color).toBe("rgb(0, 102, 204)");
    expect(sources.color).toBe("[computed]");
  });

  it("computed가 비면 specified에서 제거한다", () => {
    const all: Record<string, string> = { font: "bold 12px Arial" };
    const sources: Record<string, string> = { font: ".x" };
    resolveUncertainSpecified(all, sources, new Set(["font"]), () => "");
    expect("font" in all).toBe(false);
    expect("font" in sources).toBe(false);
  });

  it("uncertain이 아닌 prop은 건드리지 않는다", () => {
    const all: Record<string, string> = { color: "#333", padding: "8px" };
    resolveUncertainSpecified(all, {}, new Set(["color"]), () => "rgb(1, 2, 3)");
    expect(all.padding).toBe("8px");
  });
});

describe("shouldOverwriteSpecified", () => {
  it("author var() 값은 뒤따르는 리터럴로부터 보호된다", () => {
    expect(shouldOverwriteSpecified("var(--c)", "red", false)).toBe(false);
  });

  // !important는 specificity보다 상위 규칙이라, 뒤에 오는 일반 선언이 이길 수 없다.
  it("!important로 확정된 자리는 일반 선언이 못 덮는다", () => {
    expect(shouldOverwriteSpecified("red", "blue", false, true, false)).toBe(false);
  });

  it("!important끼리는 뒤가 이긴다", () => {
    expect(shouldOverwriteSpecified("red", "blue", false, true, true)).toBe(true);
  });

  it("파생된 var() 값은 뒤 규칙의 리터럴에 자리를 내준다", () => {
    expect(shouldOverwriteSpecified("var(--c)", "red", true)).toBe(true);
  });

  it("var() → var() 와 리터럴 → 리터럴은 last-wins", () => {
    expect(shouldOverwriteSpecified("var(--a)", "var(--b)", false)).toBe(true);
    expect(shouldOverwriteSpecified("red", "blue", false)).toBe(true);
  });

  it("빈 자리는 항상 채운다", () => {
    expect(shouldOverwriteSpecified(undefined, "red", false)).toBe(true);
  });
});

describe("normalizePositionOffsets — 미지정 오프셋 auto 정규화", () => {
  it("작성자 미지정 변은 computed used px 대신 auto", () => {
    const computed: Record<string, string> = {
      top: "16px",
      right: "480px",
      bottom: "240px",
      left: "24px",
    };
    const specified: Record<string, string> = { top: "16px", left: "24px" };
    normalizePositionOffsets(computed, specified);
    expect(computed.top).toBe("16px");
    expect(computed.left).toBe("24px");
    expect(computed.right).toBe("auto");
    expect(computed.bottom).toBe("auto");
  });

  it("작성자 지정 변은 computed 값을 보존", () => {
    const computed: Record<string, string> = { top: "16px", bottom: "8px" };
    const specified: Record<string, string> = { top: "16px", bottom: "8px" };
    normalizePositionOffsets(computed, specified);
    expect(computed.top).toBe("16px");
    expect(computed.bottom).toBe("8px");
  });
});

describe("resolveVarChain", () => {
  it("var 없는 값은 그대로 반환", () => {
    expect(resolveVarChain("16px", {})).toBe("16px");
    expect(resolveVarChain("#fff", {})).toBe("#fff");
  });

  it("public 토큰은 보존 (resolve 안 함)", () => {
    const props = { "--color-text": "#333" };
    expect(resolveVarChain("var(--color-text)", props)).toBe(
      "var(--color-text)",
    );
  });

  it("private 토큰(--_)은 펼침", () => {
    const props = { "--_padding": "16px" };
    expect(resolveVarChain("var(--_padding)", props)).toBe("16px");
  });

  it("private → public 체인: public에서 멈춤", () => {
    const props = {
      "--_pad": "var(--spacing-4)",
      "--spacing-4": "16px",
    };
    expect(resolveVarChain("var(--_pad)", props)).toBe("var(--spacing-4)");
  });

  it("private → private → literal 체인", () => {
    const props = {
      "--_a": "var(--_b)",
      "--_b": "24px",
    };
    expect(resolveVarChain("var(--_a)", props)).toBe("24px");
  });

  it("순환 참조 방지: --_a→--_b→--_a에서 visited로 멈춤", () => {
    const props = {
      "--_a": "var(--_b)",
      "--_b": "var(--_a)",
    };
    const result = resolveVarChain("var(--_a)", props);
    expect(result).toBe("var(--_a)");
  });

  it("depth 5 초과 시 중단", () => {
    const props: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      props[`--_v${i}`] = `var(--_v${i + 1})`;
    }
    props["--_v10"] = "final";
    const result = resolveVarChain("var(--_v0)", props);
    expect(result).not.toBe("final");
  });

  it("정의 안 된 변수는 원본 유지", () => {
    expect(resolveVarChain("var(--_unknown)", {})).toBe("var(--_unknown)");
  });

  it("fallback var: primary 없고 fallback이 private면 펼침 (nested ) 균형)", () => {
    const props = { "--_fallback": "10px" };
    const result = resolveVarChain("var(--missing, var(--_fallback))", props);
    expect(result).toBe("10px");
  });

  it("같은 private 토큰 반복(sibling)은 각각 펼침", () => {
    const props = { "--_x": "10px" };
    expect(resolveVarChain("var(--_x) var(--_x)", props)).toBe("10px 10px");
  });

  it("같은 private 토큰이 shorthand 내 반복돼도 모두 펼침", () => {
    const props = { "--_g": "8px" };
    expect(resolveVarChain("var(--_g) var(--_g) var(--_g)", props)).toBe(
      "8px 8px 8px",
    );
  });

  // public 토큰은 여전히 이름으로 보존하되, **실효 토큰의 이름**으로 좁힌다. 원문을 그대로
  // 돌려주면 firstVarName·extractTokenRefs가 죽은 변수(--missing)만 노출한다.
  it("fallback var: primary 없고 fallback이 public이면 실효 토큰 이름으로 좁힌다", () => {
    const props = { "--spacing-4": "16px" };
    const result = resolveVarChain("var(--missing, var(--spacing-4))", props);
    expect(result).toBe("var(--spacing-4)");
  });

  it("fallback 체인 전체가 미정의면 원문 보존", () => {
    expect(resolveVarChain("var(--missing, var(--also-missing))", {})).toBe(
      "var(--missing, var(--also-missing))",
    );
  });

  // 2단 이상 중첩 fallback. 정규식 `[^)]*`가 닫는 괄호를 못 먹어 1단에서만 동작했다.
  it("2단 중첩 fallback의 private alias를 리터럴까지 펼친다", () => {
    const props = { "--_ink": "#111" };
    expect(resolveVarChain("var(--a, var(--b, var(--_ink)))", props)).toBe("#111");
  });

  it("3단 중첩 fallback도 끝까지 따라간다", () => {
    const props = { "--_ink": "#111" };
    expect(
      resolveVarChain("var(--a, var(--b, var(--c, var(--_ink))))", props),
    ).toBe("#111");
  });

  it("중첩 fallback 중간에 정의된 값이 있으면 거기서 멈춘다", () => {
    const props = { "--_mid": "4px", "--_ink": "#111" };
    expect(resolveVarChain("var(--a, var(--_mid, var(--_ink)))", props)).toBe("4px");
  });

  it("중첩 fallback이 public 토큰이면 그 이름으로 좁힌다", () => {
    const props = { "--spacing-4": "16px" };
    expect(
      resolveVarChain("var(--a, var(--b, var(--spacing-4)))", props),
    ).toBe("var(--spacing-4)");
  });

  it("복수 var가 있는 값", () => {
    const props = {
      "--_x": "10px",
      "--_y": "20px",
    };
    expect(resolveVarChain("var(--_x) var(--_y)", props)).toBe("10px 20px");
  });
});

describe("tokenizeEditableText", () => {
  it("줄바꿈 없으면 단일 text 토큰", () => {
    expect(tokenizeEditableText("hello")).toEqual([
      { kind: "text", value: "hello" },
    ]);
  });

  it("빈 문자열도 단일 빈 text 토큰", () => {
    expect(tokenizeEditableText("")).toEqual([{ kind: "text", value: "" }]);
  });

  it("\\n 사이에 br 토큰 삽입", () => {
    expect(tokenizeEditableText("a\nb")).toEqual([
      { kind: "text", value: "a" },
      { kind: "br" },
      { kind: "text", value: "b" },
    ]);
  });

  it("연속된 \\n은 빈 text와 br 교차", () => {
    expect(tokenizeEditableText("a\n\nb")).toEqual([
      { kind: "text", value: "a" },
      { kind: "br" },
      { kind: "text", value: "" },
      { kind: "br" },
      { kind: "text", value: "b" },
    ]);
  });

  it("선행/후행 \\n도 빈 text로 표현", () => {
    expect(tokenizeEditableText("\nx\n")).toEqual([
      { kind: "text", value: "" },
      { kind: "br" },
      { kind: "text", value: "x" },
      { kind: "br" },
      { kind: "text", value: "" },
    ]);
  });
});

describe("classifyEditableChildren", () => {
  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;

  it("자식 없으면 none", () => {
    expect(classifyEditableChildren([])).toBe("none");
  });

  it("단일 텍스트 자식(비어있지 않음)은 multi-promote-text — \\n 입력을 <br>로 변환할 수 있는 안전 케이스", () => {
    expect(
      classifyEditableChildren([
        { nodeType: TEXT_NODE, textContent: "foo" },
      ]),
    ).toBe("multi-promote-text");
  });

  it("단일 텍스트가 공백/빈 문자열뿐이면 single — caller findEditableTextNode가 null 반환해서 결과적으로 편집 불가", () => {
    expect(
      classifyEditableChildren([
        { nodeType: TEXT_NODE, textContent: "   " },
      ]),
    ).toBe("single");
    expect(
      classifyEditableChildren([{ nodeType: TEXT_NODE, textContent: "" }]),
    ).toBe("single");
    expect(
      classifyEditableChildren([{ nodeType: TEXT_NODE, textContent: null }]),
    ).toBe("single");
  });

  it("텍스트 + br 혼합 (br 1개 이상)은 multi-existing-br — 기존 동작 보존", () => {
    expect(
      classifyEditableChildren([
        { nodeType: TEXT_NODE, textContent: "a" },
        { nodeType: ELEMENT_NODE, tagName: "BR" },
        { nodeType: TEXT_NODE, textContent: "b" },
      ]),
    ).toBe("multi-existing-br");
  });

  it("자식이 br 1개뿐이어도 multi-existing-br", () => {
    expect(
      classifyEditableChildren([
        { nodeType: ELEMENT_NODE, tagName: "BR" },
      ]),
    ).toBe("multi-existing-br");
  });

  it("단일 <strong> 인라인 마크업은 single — multi 승격하지 않음 (인라인 보호)", () => {
    expect(
      classifyEditableChildren([
        { nodeType: ELEMENT_NODE, tagName: "STRONG" },
      ]),
    ).toBe("single");
  });

  it("단일 <a>도 single — multi 승격하지 않음", () => {
    expect(
      classifyEditableChildren([
        { nodeType: ELEMENT_NODE, tagName: "A" },
      ]),
    ).toBe("single");
  });

  it("<strong> + 텍스트 혼합도 single (인라인 마크업 섞이면 보호)", () => {
    expect(
      classifyEditableChildren([
        { nodeType: ELEMENT_NODE, tagName: "STRONG" },
        { nodeType: TEXT_NODE, textContent: "tail" },
      ]),
    ).toBe("single");
  });

  it("텍스트 노드 2개 (br 없음)는 single — 기존 동작 유지 (multi 승격은 단일 텍스트일 때만)", () => {
    expect(
      classifyEditableChildren([
        { nodeType: TEXT_NODE, textContent: "a" },
        { nodeType: TEXT_NODE, textContent: "b" },
      ]),
    ).toBe("single");
  });

  it("<a> + br 혼합은 single — non-BR 엘리먼트가 섞이면 multi-existing-br 자격 박탈", () => {
    expect(
      classifyEditableChildren([
        { nodeType: ELEMENT_NODE, tagName: "A" },
        { nodeType: ELEMENT_NODE, tagName: "BR" },
      ]),
    ).toBe("single");
  });
});

describe("readEditableText — flat handle", () => {
  it("인라인 자식이 포함된 요소의 전체 textContent를 반환", () => {
    const handle: EditableHandle = {
      kind: "flat",
      el: { textContent: "Web bugs, captured in seconds." } as unknown as Element,
      originalChildren: [],
    };
    expect(readEditableText(handle)).toBe("Web bugs, captured in seconds.");
  });

  it("textContent가 null이면 빈 문자열 반환", () => {
    const handle: EditableHandle = {
      kind: "flat",
      el: { textContent: null } as unknown as Element,
      originalChildren: [],
    };
    expect(readEditableText(handle)).toBe("");
  });
});

describe("writeEditableText — flat handle", () => {
  it("el.textContent에 새 텍스트를 설정", () => {
    const el = { textContent: "old" } as unknown as Element;
    const handle: EditableHandle = { kind: "flat", el, originalChildren: [] };
    writeEditableText(handle, "new text");
    expect(el.textContent).toBe("new text");
  });
});

describe("shouldRestoreEditable", () => {
  it("텍스트 미변경(flat) — false: replaceChildren 스킵해 리스너 보존", () => {
    const handle: EditableHandle = {
      kind: "flat",
      el: { textContent: "Submit" } as unknown as Element,
      originalChildren: [],
    };
    expect(shouldRestoreEditable(handle, "Submit")).toBe(false);
  });

  it("텍스트 변경(flat) — true: 복원 실행", () => {
    const handle: EditableHandle = {
      kind: "flat",
      el: { textContent: "Submit edited" } as unknown as Element,
      originalChildren: [],
    };
    expect(shouldRestoreEditable(handle, "Submit")).toBe(true);
  });

  it("originalText가 null이면 false", () => {
    const handle: EditableHandle = {
      kind: "flat",
      el: { textContent: "Submit" } as unknown as Element,
      originalChildren: [],
    };
    expect(shouldRestoreEditable(handle, null)).toBe(false);
  });

  it("single 핸들 — 텍스트 동일하면 false", () => {
    const handle: EditableHandle = {
      kind: "single",
      node: { textContent: "hello" } as unknown as Text,
    };
    expect(shouldRestoreEditable(handle, "hello")).toBe(false);
    expect(shouldRestoreEditable(handle, "world")).toBe(true);
  });
});

describe("hydrateReferencedCustomProps", () => {
  it("브라우저가 계산한 실제 custom property winner로 raw 수집값을 덮음", () => {
    const customProps = { "--_color": "red" };
    hydrateReferencedCustomProps(
      ["var(--_color)"],
      { getPropertyValue: (name) => (name === "--_color" ? "blue" : "") },
      customProps,
    );
    expect(customProps).toEqual({ "--_color": "blue" });
  });

  it("raw 원문이 computed 승자와 같은 값으로 풀리면 원문(토큰 이름)을 보존", () => {
    // 실사이트(course-chatbot): 인라인 `--_text: var(--color-semantic-informative-label)`.
    // Chrome computed는 custom property를 완전 치환해 `#fff`를 주므로, 무조건 덮으면
    // private alias를 펼칠 때 도착지가 리터럴이라 편집 탭·CSS 뷰에서 토큰 이름이 사라진다.
    const customProps: Record<string, string> = {
      "--_text": "var(--color-semantic-informative-label)",
      "--color-semantic-informative-label": "#fff",
    };
    hydrateReferencedCustomProps(
      ["var(--_text)"],
      {
        getPropertyValue: (name) =>
          name === "--_text" || name === "--color-semantic-informative-label"
            ? "#fff"
            : "",
      },
      customProps,
    );
    expect(customProps["--_text"]).toBe("var(--color-semantic-informative-label)");
  });

  it("표기 차이(대소문자·공백)만 다르면 같은 값으로 보고 원문 유지", () => {
    const customProps: Record<string, string> = {
      "--_bg": "var(--brand)",
      "--brand": "rgb(0, 0, 0)",
    };
    hydrateReferencedCustomProps(
      ["var(--_bg)"],
      {
        getPropertyValue: (name) =>
          name === "--_bg" ? "rgb(0,0,0)" : name === "--brand" ? "RGB(0, 0, 0)" : "",
      },
      customProps,
    );
    expect(customProps["--_bg"]).toBe("var(--brand)");
  });

  it("후보가 여럿이어도 승자와 일치하는 게 하나뿐이면 그 이름을 보존한다", () => {
    // 후보를 버리지 않고 들고 있으면 판별이 된다 — first-write가 실제 승자인 경우
    // (id 규칙·!important·layer 순서)까지 이름을 잃을 이유가 없다.
    const customProps: Record<string, string> = {
      "--_text": "var(--token-a)",
      "--token-a": "#111",
      "--token-b": "#222",
    };
    hydrateReferencedCustomProps(
      ["var(--_text)"],
      {
        getPropertyValue: (name) =>
          name === "--_text" || name === "--token-a"
            ? "#111"
            : name === "--token-b"
              ? "#222"
              : "",
      },
      customProps,
      new Map([["--_text", new Set(["var(--token-a)", "var(--token-b)"])]]),
    );
    expect(customProps["--_text"]).toBe("var(--token-a)");
  });

  it("같은 이름을 여러 선언이 다르게 정의했으면 이름을 포기하고 computed를 쓴다", () => {
    // 값이 같다는 건 그 원문이 **승자 선언**이라는 증명이 아니다 — 서로 다른 토큰이 지금 같은
    // 값이면(둘 다 #fff) first-write-wins로 잡힌 패자 이름을 그대로 노출하게 된다.
    const customProps: Record<string, string> = {
      "--_text": "var(--token-a)",
      "--token-a": "#fff",
      "--token-b": "#fff",
    };
    hydrateReferencedCustomProps(
      ["var(--_text)"],
      { getPropertyValue: () => "#fff" },
      customProps,
      new Map([["--_text", new Set(["var(--token-a)", "var(--token-b)"])]]),
    );
    expect(customProps["--_text"]).toBe("#fff");
  });

  it("충돌이 없으면 종전대로 원문을 보존한다", () => {
    const customProps: Record<string, string> = {
      "--_text": "var(--token-a)",
      "--token-a": "#fff",
    };
    hydrateReferencedCustomProps(
      ["var(--_text)"],
      { getPropertyValue: () => "#fff" },
      customProps,
      new Map(),
    );
    expect(customProps["--_text"]).toBe("var(--token-a)");
  });

  it("raw가 승자와 다른 값으로 풀리면 computed로 덮는다 (승자 판정 유지)", () => {
    const customProps: Record<string, string> = {
      "--_text": "var(--stale)",
      "--stale": "red",
    };
    hydrateReferencedCustomProps(
      ["var(--_text)"],
      {
        getPropertyValue: (name) =>
          name === "--_text" ? "blue" : name === "--stale" ? "red" : "",
      },
      customProps,
    );
    expect(customProps["--_text"]).toBe("blue");
  });

  it("raw가 가리키는 이름의 값을 모르면 덮는다 (검증 불가)", () => {
    const customProps: Record<string, string> = { "--_text": "var(--unknown)" };
    hydrateReferencedCustomProps(
      ["var(--_text)"],
      { getPropertyValue: (name) => (name === "--_text" ? "#fff" : "") },
      customProps,
    );
    expect(customProps["--_text"]).toBe("#fff");
  });

  it("중첩 fallback 안의 이름도 수집한다", () => {
    // 원문을 유지하면 그 원문이 참조하는 이름들이 큐에 실려야 한다 — 정규식은 첫 `)`에서
    // 끊겨 `var(--miss, var(--inner))`의 --inner를 놓치고, 그러면 검증 없이 수집된 raw가
    // 그대로 펼쳐진다.
    const customProps: Record<string, string> = {};
    hydrateReferencedCustomProps(
      ["var(--miss, var(--inner))"],
      { getPropertyValue: (name) => (name === "--inner" ? "8px" : "") },
      customProps,
    );
    expect(customProps["--inner"]).toBe("8px");
  });

  it("초기 값이 많아도 원문 유지로 큐에 실린 이름을 처리한다", () => {
    // 캡이 초기 values 길이에 잡아먹히면 push된 항목이 한 번도 처리되지 않는다.
    const filler = Array.from({ length: 120 }, (_, i) => `var(--f${i})`);
    const customProps: Record<string, string> = { "--_a": "var(--brand)" };
    hydrateReferencedCustomProps(
      [...filler, "var(--_a)"],
      {
        getPropertyValue: (name) =>
          name === "--_a" || name === "--brand" ? "#fff" : "",
      },
      customProps,
    );
    expect(customProps["--_a"]).toBe("var(--brand)");
    expect(customProps["--brand"]).toBe("#fff");
  });

  it("computed alias가 참조하는 다음 custom property도 고정점까지 수집", () => {
    const customProps: Record<string, string> = {};
    hydrateReferencedCustomProps(
      ["var(--_a)"],
      {
        getPropertyValue: (name) =>
          name === "--_a" ? "var(--_b)" : name === "--_b" ? "12px" : "",
      },
      customProps,
    );
    expect(customProps).toEqual({ "--_a": "var(--_b)", "--_b": "12px" });
  });
});

describe("resolveUncertainSpecified — 토큰 보존 트레이드오프의 적용 면적", () => {
  it("private alias가 원문으로 남으면 uncertain이어도 computed로 교정하지 않는다", () => {
    // hydrate가 원문(토큰 이름)을 보존하게 되면서, 예전엔 리터럴로 붕괴해 computed 교정을
    // 받던 alias 경유 값이 이제 var()로 끝나 skip 경로로 간다 — 값 정확도보다 토큰 이름을
    // 택한다는 이 함수의 선언된 트레이드오프가 alias 체인 전체로 넓어진 것이다.
    const all: Record<string, string> = { color: "var(--color-x)" };
    const sources: Record<string, string> = { color: ".a" };
    resolveUncertainSpecified(all, sources, new Set(["color"]), () => "rgb(255, 0, 0)");
    expect(all.color).toBe("var(--color-x)");
    expect(sources.color).toBe(".a");
  });

  it("var()가 없으면 종전대로 computed 승자로 교정한다", () => {
    const all: Record<string, string> = { color: "#fff" };
    const sources: Record<string, string> = { color: ".a" };
    resolveUncertainSpecified(all, sources, new Set(["color"]), () => "rgb(255, 0, 0)");
    expect(all.color).toBe("rgb(255, 0, 0)");
    expect(sources.color).toBe("[computed]");
  });
});

describe("collectReferencedTokenNames", () => {
  it("specified 값의 var() 참조 이름을 빈 값으로 seen에 추가", () => {
    // naver: 정의는 CORS 시트라 못 읽지만 background-color: var(--…) 참조는 specified에
    // 남는다. 이름만 넣으면 resolve 루프가 getComputedStyle로 실제 색을 채워 swatch가 뜬다.
    const seen = new Map<string, string>();
    collectReferencedTokenNames(
      { "background-color": "var(--color-primary-background-default)" },
      seen,
    );
    expect(seen.has("--color-primary-background-default")).toBe(true);
    expect(seen.get("--color-primary-background-default")).toBe("");
  });

  it("여러 prop·여러 참조 모두 수집", () => {
    const seen = new Map<string, string>();
    collectReferencedTokenNames(
      { color: "var(--fg)", border: "1px solid var(--line)" },
      seen,
    );
    expect(seen.has("--fg")).toBe(true);
    expect(seen.has("--line")).toBe(true);
  });

  it("fallback 있는 var()도 이름 추출", () => {
    const seen = new Map<string, string>();
    collectReferencedTokenNames({ color: "var(--fg, #fff)" }, seen);
    expect(seen.has("--fg")).toBe(true);
  });

  it("이미 있는 이름은 덮지 않음 (definition 값 우선)", () => {
    const seen = new Map<string, string>([["--fg", "#03A94D"]]);
    collectReferencedTokenNames({ color: "var(--fg)" }, seen);
    expect(seen.get("--fg")).toBe("#03A94D");
  });

  it("var() 없는 값은 무시", () => {
    const seen = new Map<string, string>();
    collectReferencedTokenNames({ color: "#333", padding: "8px" }, seen);
    expect(seen.size).toBe(0);
  });
});

describe("mergeCrossOriginDecls", () => {
  const co = (selectorText: string, decls: Record<string, string>) => ({
    selectorText,
    decls: new Map(Object.entries(decls)),
  });

  it("빈 prop을 cross-origin 값으로 채우고 source는 selectorText", () => {
    const out: Record<string, string> = {};
    const sources: Record<string, string> = {};
    mergeCrossOriginDecls(out, sources, {}, [co(".card", { padding: "12px" })], {});
    expect(out.padding).toBe("12px");
    expect(sources.padding).toBe(".card");
  });

  it("same-origin이 이미 채운 prop은 보존 (cross-origin이 덮지 않음)", () => {
    const out: Record<string, string> = { color: "green" };
    const sources: Record<string, string> = { color: ".same" };
    mergeCrossOriginDecls(out, sources, {}, [co(".x", { color: "red" })], {});
    expect(out.color).toBe("green");
    expect(sources.color).toBe(".same");
  });

  it("아직 안 펼쳐진 same-origin shorthand의 longhand는 cross-origin이 못 덮음 (split 방지)", () => {
    // collectRulesForElement는 expandShorthands 전에 merge하므로 out엔 shorthand만 있다.
    const out: Record<string, string> = { padding: "10px" };
    const sources: Record<string, string> = { padding: ".same" };
    mergeCrossOriginDecls(
      out,
      sources,
      {},
      [co(".card", { "padding-left": "3px" })],
      {},
    );
    expect(out["padding-left"]).toBeUndefined();
  });

  it("same-origin shorthand 없는 longhand는 cross-origin이 정상 보강", () => {
    const out: Record<string, string> = {};
    const sources: Record<string, string> = {};
    mergeCrossOriginDecls(
      out,
      sources,
      {},
      [co(".card", { "padding-left": "3px" })],
      {},
    );
    expect(out["padding-left"]).toBe("3px");
  });

  it("cross-origin 규칙끼리는 뒤(seq 큰) 규칙이 override", () => {
    const out: Record<string, string> = {};
    const sources: Record<string, string> = {};
    // 호출부가 seq 오름차순으로 정렬해 전달
    mergeCrossOriginDecls(
      out,
      sources,
      {},
      [co(".a", { color: "red" }), co(".b", { color: "blue" })],
      {},
    );
    expect(out.color).toBe("blue");
    expect(sources.color).toBe(".b");
  });

  it("same-origin border shorthand의 per-side longhand는 cross-origin이 못 덮음", () => {
    // collectRulesForElement는 expandShorthands 전에 merge하므로 out엔 border만 있다.
    const out: Record<string, string> = { border: "1px solid blue" };
    const sources: Record<string, string> = { border: ".same" };
    mergeCrossOriginDecls(
      out,
      sources,
      {},
      [co(".card", { "border-top-color": "red" })],
      {},
    );
    expect(out["border-top-color"]).toBeUndefined();
  });

  it("same-origin border-bottom의 longhand도 cross-origin이 못 덮음", () => {
    const out: Record<string, string> = { "border-bottom": "2px dashed green" };
    const sources: Record<string, string> = { "border-bottom": ".same" };
    mergeCrossOriginDecls(
      out,
      sources,
      {},
      [co(".x", { "border-bottom-width": "9px" })],
      {},
    );
    expect(out["border-bottom-width"]).toBeUndefined();
  });

  it("이른 var(토큰)을 나중 cross-origin literal이 덮지 않음 (token 강등 회귀 방지)", () => {
    // naver <a>: 테마 규칙 color: var(--fg)을 뒤따르는 일반 a { color: #333 } 리셋이
    // 클로버해 토큰이 computed로 강등되던 버그. background-color는 단일 선언이라 멀쩡.
    const out: Record<string, string> = {};
    const sources: Record<string, string> = {};
    mergeCrossOriginDecls(
      out,
      sources,
      {},
      [
        co(".themed", {
          color: "var(--fg)",
          "background-color": "var(--bg)",
          "border-color": "var(--line)",
        }),
        co("a", { color: "#333", "border-color": "gray" }),
      ],
      {},
    );
    expect(out.color).toBe("var(--fg)");
    expect(sources.color).toBe(".themed");
    expect(out["border-color"]).toBe("var(--line)");
    expect(out["background-color"]).toBe("var(--bg)");
  });

  it("나중 var는 이른 cross-origin literal을 정상 덮음 (token 승격 유지)", () => {
    const out: Record<string, string> = {};
    const sources: Record<string, string> = {};
    mergeCrossOriginDecls(
      out,
      sources,
      {},
      [co("a", { color: "#333" }), co(".themed", { color: "var(--fg)" })],
      {},
    );
    expect(out.color).toBe("var(--fg)");
    expect(sources.color).toBe(".themed");
  });

  it("--*를 customProps에 보충해 기존 규칙(private --_)으로 var() 해석", () => {
    const customProps: Record<string, string> = {};
    mergeCrossOriginDecls(
      {},
      {},
      customProps,
      [co(".card", { color: "var(--_brand)" })],
      { "--_brand": "#06c" },
    );
    expect(customProps["--_brand"]).toBe("#06c");
    // resolveVarChain은 same-origin과 동일하게 private --_ 변수만 펼친다.
    expect(resolveVarChain("var(--_brand)", customProps)).toBe("#06c");
  });

  it("이미 있는 customProps 키는 cross-origin이 덮지 않음", () => {
    const customProps: Record<string, string> = { "--_brand": "#000" };
    mergeCrossOriginDecls({}, {}, customProps, [], { "--_brand": "#fff" });
    expect(customProps["--_brand"]).toBe("#000");
  });

  it("wantedProps 지정 시 그 외 prop은 무시", () => {
    const out: Record<string, string> = {};
    mergeCrossOriginDecls(
      out,
      {},
      {},
      [co(".x", { color: "red", padding: "8px" })],
      {},
      new Set(["color"]),
    );
    expect(out.color).toBe("red");
    expect(out.padding).toBeUndefined();
  });
});

describe("mergeCrossOriginTokens", () => {
  it("빈 seen에 cross-origin custom prop을 토큰 후보로 추가", () => {
    // naver: --color-primary-background-default가 cross-origin :root에만 있어
    // collectTokens의 same-origin/inline 수집에 안 잡히던 것 — swatch 누락 원인.
    const seen = new Map<string, string>();
    mergeCrossOriginTokens(seen, {
      "--color-primary-background-default": "#03c75a",
    });
    expect(seen.get("--color-primary-background-default")).toBe("#03c75a");
    expect(seen.size).toBe(1);
  });

  it("이미 있는 이름은 cross-origin이 덮지 않음 (same-origin 우선·빈칸 채우기)", () => {
    const seen = new Map<string, string>([["--brand", "#000"]]);
    mergeCrossOriginTokens(seen, { "--brand": "#fff" });
    expect(seen.get("--brand")).toBe("#000");
  });

  it("일부만 충돌 — 충돌은 유지, 신규는 추가", () => {
    const seen = new Map<string, string>([["--a", "red"]]);
    mergeCrossOriginTokens(seen, { "--a": "blue", "--b": "green" });
    expect(seen.get("--a")).toBe("red");
    expect(seen.get("--b")).toBe("green");
  });

  it("빈 crossProps면 seen 불변", () => {
    const seen = new Map<string, string>([["--x", "1px"]]);
    mergeCrossOriginTokens(seen, {});
    expect(seen.size).toBe(1);
    expect(seen.get("--x")).toBe("1px");
  });

  it("-- 접두 아닌 키는 무시 (방어)", () => {
    const seen = new Map<string, string>();
    mergeCrossOriginTokens(seen, { color: "red", "--ok": "#fff" });
    expect(seen.has("color")).toBe(false);
    expect(seen.get("--ok")).toBe("#fff");
  });
});

describe("resolveTokenValue — 토큰 목록의 값/category 판정용 완전 해석", () => {
  it("public alias도 값까지 펼친다 (resolveVarChain은 이름을 보존해 var(…)로 남는다)", () => {
    const props = { "--blue-500": "#06f", "--color-primary": "var(--blue-500)" };
    // 이름 보존 규칙(specified 표기)은 그대로 — 값 판정 경로만 갈린다.
    expect(resolveVarChain("var(--color-primary)", props)).toBe("var(--color-primary)");
    expect(resolveTokenValue("var(--blue-500)", props)).toBe("#06f");
  });

  it("2단 체인도 끝까지 해석", () => {
    const props = {
      "--blue-500": "#06f",
      "--color-primary": "var(--blue-500)",
      "--color-brand": "var(--color-primary)",
    };
    expect(resolveTokenValue("var(--color-brand)", props)).toBe("#06f");
  });

  it("사이클은 멈춘다 (원본 참조 유지)", () => {
    const props = { "--a": "var(--b)", "--b": "var(--a)" };
    expect(resolveTokenValue("var(--a)", props, 0, new Set(["--a"]))).toBe("var(--a)");
  });

  it("미정의 이름은 fallback으로 해석", () => {
    expect(resolveTokenValue("var(--nope, 8px)", {})).toBe("8px");
    expect(resolveTokenValue("var(--nope, var(--gap))", { "--gap": "16px" })).toBe("16px");
  });

  it("fallback도 없으면 원문 유지 / var 없으면 그대로", () => {
    expect(resolveTokenValue("var(--nope)", {})).toBe("var(--nope)");
    expect(resolveTokenValue("#fff", {})).toBe("#fff");
    expect(resolveTokenValue("", {})).toBe("");
  });

  it("값 일부에 섞인 참조도 치환 (shorthand)", () => {
    const props = { "--sp": "4px", "--c": "red" };
    expect(resolveTokenValue("1px solid var(--c)", props)).toBe("1px solid red");
    expect(resolveTokenValue("var(--sp) var(--sp)", props)).toBe("4px 4px");
  });

  it("해석된 값이 category 판정으로 이어진다", () => {
    const props = { "--blue-500": "#06f", "--color-primary": "var(--blue-500)" };
    expect(categorizeToken(resolveTokenValue("var(--blue-500)", props))).toBe("color");
    expect(categorizeToken("var(--blue-500)")).toBe("unknown");
  });
});

describe("selectorSpecificity", () => {
  it("기본 성분: type/class/id/복합/universal", () => {
    expect(selectorSpecificity("div")).toEqual([0, 0, 1]);
    expect(selectorSpecificity(".a")).toEqual([0, 1, 0]);
    expect(selectorSpecificity("#a")).toEqual([1, 0, 0]);
    expect(selectorSpecificity("div.a#b")).toEqual([1, 1, 1]);
    expect(selectorSpecificity("*")).toEqual([0, 0, 0]);
  });

  it("결합자는 무기여", () => {
    expect(selectorSpecificity(".a > .b")).toEqual([0, 2, 0]);
    expect(selectorSpecificity(".a .b ~ .c")).toEqual([0, 3, 0]);
  });

  it("pseudo-class는 b, pseudo-element는 c (레거시 단일콜론 포함)", () => {
    expect(selectorSpecificity(".x:hover")).toEqual([0, 2, 0]);
    expect(selectorSpecificity("div::before")).toEqual([0, 0, 2]);
    expect(selectorSpecificity("div:before")).toEqual([0, 0, 2]);
  });

  it("함수형 pseudo-class는 인자를 스킵하고 b 1회", () => {
    expect(selectorSpecificity("li:nth-child(2n)")).toEqual([0, 1, 1]);
  });

  it(":where()는 0 기여 (인자 스킵)", () => {
    expect(selectorSpecificity(".x:where(.a #b)")).toEqual([0, 1, 0]);
  });

  it("따옴표 안 콤마·괄호는 attr 카운트를 오염시키지 않는다", () => {
    expect(selectorSpecificity('[data-x="a,b(c"]')).toEqual([0, 1, 0]);
  });

  it("[attr|=x]는 정상 b 카운트 (대괄호 스킵에 흡수)", () => {
    expect(selectorSpecificity("[attr|=x]")).toEqual([0, 1, 0]);
  });

  it("이스케이프 다음 문자는 pseudo로 세지 않는다", () => {
    expect(selectorSpecificity(".a\\:b")).toEqual([0, 1, 0]);
  });

  it("판정 불가 셀렉터는 null (보수적 uncertain 처리)", () => {
    const unresolvable = [
      ":is(.a)",
      ":not(.a)",
      ":has(.a)",
      "::part(x)",
      "::slotted(.a)",
      "& .a",
      "li:nth-child(2n of .a)",
      "ns|div",
      ":host(.a)",
    ];
    for (const s of unresolvable) {
      expect(selectorSpecificity(s), s).toBeNull();
    }
  });
});

describe("compareSpecificity", () => {
  it("사전식 비교 — 성분 cap 없음 (스칼라 인코딩 회귀 방지)", () => {
    expect(compareSpecificity([0, 1000, 0], [1, 0, 0])).toBe(-1);
    expect(compareSpecificity([1, 0, 0], [0, 1000, 0])).toBe(1);
    expect(compareSpecificity([0, 0, 1000], [0, 1, 0])).toBe(-1);
  });

  it("동일 튜플은 0", () => {
    expect(compareSpecificity([0, 2, 1], [0, 2, 1])).toBe(0);
  });
});

describe("matchedSpecificity", () => {
  it("매치되는 파트 중 최고 specificity를 취한다", () => {
    const el = { matches: (s: string) => s === ".a" || s === "#b" };
    expect(matchedSpecificity(el, ".a, #b")).toEqual([1, 0, 0]);
  });

  it("비매치 파트는 specificity가 높거나 null이어도 무시한다", () => {
    const el = { matches: (s: string) => s === ".a" };
    expect(matchedSpecificity(el, ".a, #b")).toEqual([0, 1, 0]);
    expect(matchedSpecificity(el, ".a, :is(.b)")).toEqual([0, 1, 0]);
  });

  it("매치된 파트가 null-spec이면 전체 null (그 파트가 최고일 수 있다)", () => {
    const el = { matches: () => true };
    expect(matchedSpecificity(el, ".a, :is(.b)")).toBeNull();
  });

  it("el.matches가 throw하면 null", () => {
    const el = {
      matches: () => {
        throw new Error("invalid selector");
      },
    };
    expect(matchedSpecificity(el, ".a")).toBeNull();
  });

  it("매치 파트 0개면 null (인덱스 손상 등 비정상)", () => {
    const el = { matches: () => false };
    expect(matchedSpecificity(el, ".a, .b")).toBeNull();
  });
});

describe("hasOpaqueCascadeContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bare = (extra: object = {}) =>
    ({ parentRule: null, parentStyleSheet: null, ...extra }) as unknown as CSSStyleRule;

  it("CSS rule 전역 부재(node)에서도 throw 없이 false", () => {
    expect(hasOpaqueCascadeContext(bare())).toBe(false);
  });

  it("parentRule 체인의 CSSLayerBlockRule → true (중간 그룹 규칙 통과)", () => {
    class FakeLayerBlock {}
    vi.stubGlobal("CSSLayerBlockRule", FakeLayerBlock);
    const media = { parentRule: new FakeLayerBlock(), parentStyleSheet: null };
    expect(hasOpaqueCascadeContext(bare({ parentRule: media }))).toBe(true);
  });

  it("parentRule 체인의 CSSScopeRule → true", () => {
    class FakeScope {}
    vi.stubGlobal("CSSScopeRule", FakeScope);
    expect(hasOpaqueCascadeContext(bare({ parentRule: new FakeScope() }))).toBe(true);
  });

  it("@import layer 소속 시트 → true (익명 layer \"\"·중첩 import 체인 포함)", () => {
    class FakeImportRule {
      layerName: string | null = null;
      parentStyleSheet: unknown = null;
    }
    vi.stubGlobal("CSSImportRule", FakeImportRule);
    const anon = new FakeImportRule();
    anon.layerName = "";
    expect(
      hasOpaqueCascadeContext(bare({ parentStyleSheet: { ownerRule: anon } })),
    ).toBe(true);
    // 중첩: layer 없는 @import 시트가 layer 있는 @import 아래에 있으면 체인 상단에서 잡힌다.
    const outer = new FakeImportRule();
    outer.layerName = "base";
    const inner = new FakeImportRule();
    inner.parentStyleSheet = { ownerRule: outer };
    expect(
      hasOpaqueCascadeContext(bare({ parentStyleSheet: { ownerRule: inner } })),
    ).toBe(true);
  });

  it("layer 없는 @import(layerName null)는 false", () => {
    class FakeImportRule {
      layerName: string | null = null;
      parentStyleSheet: unknown = null;
    }
    vi.stubGlobal("CSSImportRule", FakeImportRule);
    const imp = new FakeImportRule();
    expect(
      hasOpaqueCascadeContext(bare({ parentStyleSheet: { ownerRule: imp } })),
    ).toBe(false);
  });
});

// 캐스케이드 승자 판정(important > inline > specificity > 문서순)과 verdict 반환.
// 표기 보호(shouldOverwriteSpecified)와의 역할 분리는 design.md "역할 분리" 참조.
describe("noteClaim — specificity 판정", () => {
  it("specificity 역전: 낮은 spec 후속 선언은 verdict false, 이전 승자 유지·uncertain 없음", () => {
    const claims = newClaimState();
    expect(noteClaim(claims, "color", "red", false, ".a.b", [0, 2, 0])).toBe(true);
    expect(noteClaim(claims, "color", "blue", false, ".c", [0, 1, 0])).toBe(false);
    expect(claims.candidates.get("color")?.value).toBe("red");
    expect(claims.candidates.get("color")?.origin).toBe(".a.b");
    expect(claims.uncertain.has("color")).toBe(false);
  });

  it("동률은 문서순 — 뒤 선언 채택(true), uncertain 비움", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a", [0, 1, 0]);
    expect(noteClaim(claims, "color", "blue", false, ".b", [0, 1, 0])).toBe(true);
    expect(claims.candidates.get("color")?.value).toBe("blue");
    expect(claims.uncertain.has("color")).toBe(false);
  });

  it("같은 값도 승자 비교를 탄다 — 높은 spec 이전 승자의 origin 유지", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a.b", [0, 2, 0]);
    expect(noteClaim(claims, "color", "red", false, ".c", [0, 1, 0])).toBe(false);
    expect(claims.candidates.get("color")?.origin).toBe(".a.b");
  });

  it("같은 값 known-spec 동률은 뒤 후보가 승자(true)", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a", [0, 1, 0]);
    expect(noteClaim(claims, "color", "red", false, ".b", [0, 1, 0])).toBe(true);
    expect(claims.candidates.get("color")?.origin).toBe(".b");
  });

  it("같은 값 + 어느 한쪽 null spec → 이전 후보 유지(false), uncertain 안 늘림", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a.b", [0, 2, 0]);
    expect(noteClaim(claims, "color", "red", false, ":is(.c)", null)).toBe(false);
    expect(claims.candidates.get("color")?.origin).toBe(".a.b");
    expect(claims.uncertain.has("color")).toBe(false);

    const claims2 = newClaimState();
    noteClaim(claims2, "color", "red", false, ".a", null);
    expect(noteClaim(claims2, "color", "red", false, ".b", [0, 1, 0])).toBe(false);
    expect(claims2.candidates.get("color")?.origin).toBe(".a");
    expect(claims2.uncertain.has("color")).toBe(false);
  });

  it("다른 값 + 어느 한쪽 null spec → 기존대로 채택 + uncertain(true)", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a", [0, 1, 0]);
    expect(noteClaim(claims, "color", "blue", false, ":is(.b)", null)).toBe(true);
    expect(claims.candidates.get("color")?.value).toBe("blue");
    expect(claims.uncertain.has("color")).toBe(true);
  });

  it("낮은 spec + important가 높은 spec 일반을 이긴다 (기존 분기 유지)", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a.b.c", [0, 3, 0]);
    expect(noteClaim(claims, "color", "blue", true, ".z", [0, 0, 1])).toBe(true);
    expect(claims.candidates.get("color")?.value).toBe("blue");
    // important 승자는 뒤의 높은 spec 일반 선언에도 지지 않는다.
    expect(noteClaim(claims, "color", "green", false, ".x.y", [0, 2, 0])).toBe(false);
    expect(claims.candidates.get("color")?.value).toBe("blue");
  });

  it("inline 일반 > 높은 spec 일반, important 일반 > inline 일반", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a.b.c", [0, 3, 0]);
    expect(noteClaim(claims, "color", "blue", false, "[inline]", null)).toBe(true);
    expect(claims.candidates.get("color")?.origin).toBe("[inline]");
    expect(noteClaim(claims, "color", "green", true, ".z", [0, 0, 1])).toBe(true);
    expect(claims.candidates.get("color")?.value).toBe("green");
  });

  it("null-spec 충돌로 uncertain된 prop은 후속 known-spec 패배 판정에서 delete되지 않는다", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ":is(.x)", null);
    noteClaim(claims, "color", "blue", false, ".a.b", [0, 2, 0]);
    expect(claims.uncertain.has("color")).toBe(true);
    expect(noteClaim(claims, "color", "green", false, ".c", [0, 1, 0])).toBe(false);
    expect(claims.uncertain.has("color")).toBe(true);
  });

  it("uncertain 확정 복귀 — important 도착 시 채택 + uncertain 해소", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ":is(.x)", null);
    noteClaim(claims, "color", "blue", false, ".a.b", [0, 2, 0]);
    expect(claims.uncertain.has("color")).toBe(true);
    expect(noteClaim(claims, "color", "green", true, ".z", [0, 0, 1])).toBe(true);
    expect(claims.candidates.get("color")?.value).toBe("green");
    expect(claims.uncertain.has("color")).toBe(false);
  });

  it("uncertain 확정 복귀 — inline 도착도 동일", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ":is(.x)", null);
    noteClaim(claims, "color", "blue", false, ".a.b", [0, 2, 0]);
    expect(noteClaim(claims, "color", "green", false, "[inline]", null)).toBe(true);
    expect(claims.uncertain.has("color")).toBe(false);
  });

  it("var 교차 ①: 리터럴 승자 verdict true여도 out의 author var()는 보호(의도된 비대칭)", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "var(--c)", false, ".a.b", [0, 2, 0]);
    expect(noteClaim(claims, "color", "red", false, ".a.b.c", [0, 3, 0])).toBe(true);
    expect(claims.candidates.get("color")?.value).toBe("red");
    // verdict true 뒤에도 쓰기는 shouldOverwriteSpecified를 통과해야 한다 — out은 var 유지.
    expect(shouldOverwriteSpecified("var(--c)", "red", false)).toBe(false);
  });

  it("var 교차 ②: 낮은 spec var() 후속은 verdict false — 승자 리터럴 유지(토큰 소멸 의도)", () => {
    const claims = newClaimState();
    noteClaim(claims, "color", "red", false, ".a.b.c", [0, 3, 0]);
    expect(noteClaim(claims, "color", "var(--c)", false, ".a", [0, 1, 0])).toBe(false);
    expect(claims.candidates.get("color")?.value).toBe("red");
  });
});

// 공개 경로(collectSpecifiedStylesWithSources)로 스레딩+쓰기 게이트를 수용 검증.
// node 트랙이라 window/HTMLElement/규칙을 전부 스텁한다(tasks.md Task 4 목록).
describe("collectSpecifiedStylesWithSources — specificity 수용", () => {
  const ruleStub = (
    selectorText: string,
    cssText: string,
    decls: Record<string, string> = {},
    priorities: Record<string, string> = {},
  ): CSSStyleRule => {
    const names = Object.keys(decls);
    return {
      selectorText,
      parentRule: null,
      parentStyleSheet: null,
      style: {
        length: names.length,
        item: (i: number) => names[i] ?? "",
        getPropertyValue: (n: string) => decls[n] ?? "",
        getPropertyPriority: (n: string) => priorities[n] ?? "",
        cssText,
      },
    } as unknown as CSSStyleRule;
  };

  const elStub = (matches: (sel: string) => boolean): Element =>
    ({ matches, parentElement: null }) as unknown as Element;

  beforeEach(() => {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("window", {
      getComputedStyle: () => ({
        getPropertyValue: (p: string) => (p.startsWith("--") ? "" : "rgb(1, 2, 3)"),
      }),
    });
  });

  afterEach(() => {
    mockRules.current = [];
    vi.unstubAllGlobals();
  });

  it("높은 spec 규칙 원문이 살아남고 [computed] 대체가 일어나지 않는다", () => {
    mockRules.current = [
      ruleStub(".btn.primary", "background-color: #ff0000", {
        "background-color": "#ff0000",
      }),
      ruleStub(".x", "background-color: #00ff00", {
        "background-color": "#00ff00",
      }),
    ];
    const el = elStub((s) => s === ".btn.primary" || s === ".x");
    const { styles, sources } = collectSpecifiedStylesWithSources(el);
    expect(styles["background-color"]).toBe("#ff0000");
    expect(sources["background-color"]).toBe(".btn.primary");
  });

  it("대조군: 한쪽 spec null이면 기존대로 uncertain → [computed] 대체", () => {
    mockRules.current = [
      ruleStub(".btn", "background-color: #ff0000", {
        "background-color": "#ff0000",
      }),
      ruleStub(":is(.x)", "background-color: #00ff00", {
        "background-color": "#00ff00",
      }),
    ];
    const el = elStub(() => true);
    const { styles, sources } = collectSpecifiedStylesWithSources(el);
    expect(styles["background-color"]).toBe("rgb(1, 2, 3)");
    expect(sources["background-color"]).toBe("[computed]");
  });

  it("3규칙 교차: 패자 shorthand는 직접 prop 쓰기와 파생 전개가 통째로 스킵된다", () => {
    mockRules.current = [
      ruleStub(".x.y.z", "border-top-color: var(--hi)"),
      ruleStub(".x.y", "border: 1px solid var(--mid)"),
      ruleStub(".x", "border: 2px dashed var(--lo)"),
    ];
    const el = elStub((s) => s === ".x.y.z" || s === ".x.y" || s === ".x");
    const { styles, sources } = collectSpecifiedStylesWithSources(el);
    // border 키는 spec 비교로 .x.y가 승자 — 패자 .x의 값이 out을 덮지 않는다.
    expect(styles["border"]).toBe("1px solid var(--mid)");
    expect(sources["border"]).toBe(".x.y");
    // 패자 shorthand의 파생 전개 스킵 — border-top-color가 var(--lo)로 밀리지 않는다.
    // (승자 shorthand .x.y의 파생이 직접 선언을 덮는 것은 수용된 잔여 근사 — design.md)
    expect(styles["border-top-color"]).toBe("var(--mid)");
  });

  it("var vs var null-spec 충돌은 uncertain이어도 out이 var면 [computed] 대체가 없다", () => {
    mockRules.current = [
      ruleStub(":is(.a)", "color: var(--x)"),
      ruleStub(":is(.b)", "color: var(--y)"),
    ];
    const el = elStub(() => true);
    const { styles, sources } = collectSpecifiedStylesWithSources(el);
    expect(styles["color"]).toBe("var(--y)");
    expect(sources["color"]).toBe(":is(.b)");
  });
});


