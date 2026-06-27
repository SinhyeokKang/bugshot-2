import { describe, it, expect, vi } from "vitest";

vi.mock("../css-source-cache", () => ({
  getMatchingRules: () => [],
  getRawDeclarationsFor: () => null,
  getMatchingCrossOriginRules: () => [],
  getCrossOriginCustomProps: () => ({}),
}));

import {
  resolveVarChain,
  INTERESTING_PROPS,
  categorizeToken,
  tokenizeEditableText,
  serializeEditableTokens,
  classifyEditableChildren,
  readEditableText,
  writeEditableText,
  shouldRestoreEditable,
  splitTrblValue,
  splitCssTokens,
  mergeCrossOriginDecls,
  mergeCrossOriginTokens,
  collectReferencedTokenNames,
  parseBorderShorthand,
  expandShorthands,
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

  it("충분한 수의 속성", () => {
    expect(INTERESTING_PROPS.length).toBeGreaterThanOrEqual(30);
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

  it("fallback var: regex가 nested )를 못 잡아서 원본 유지", () => {
    const props = { "--_fallback": "10px" };
    const result = resolveVarChain("var(--missing, var(--_fallback))", props);
    expect(result).toContain("var(--missing");
  });

  it("fallback var: primary 없고 fallback이 public이면 보존", () => {
    const props = { "--spacing-4": "16px" };
    const result = resolveVarChain("var(--missing, var(--spacing-4))", props);
    expect(result).toBe("var(--missing, var(--spacing-4))");
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

describe("serializeEditableTokens", () => {
  it("단일 text 토큰", () => {
    expect(serializeEditableTokens([{ kind: "text", value: "hi" }])).toBe("hi");
  });

  it("text-br-text → \\n로 join", () => {
    expect(
      serializeEditableTokens([
        { kind: "text", value: "a" },
        { kind: "br" },
        { kind: "text", value: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("tokenize ↔ serialize 라운드트립", () => {
    const samples = [
      "hello",
      "",
      "a\nb",
      "a\n\nb",
      "\nleading",
      "trailing\n",
      "Discover, fix, capture,\nand report UI bugs in one workflow.",
    ];
    for (const s of samples) {
      expect(serializeEditableTokens(tokenizeEditableText(s))).toBe(s);
    }
  });

  it("선행 br 토큰은 빈 text가 없어도 \\n 1개로 직렬화", () => {
    expect(
      serializeEditableTokens([
        { kind: "br" },
        { kind: "text", value: "x" },
      ]),
    ).toBe("\nx");
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
