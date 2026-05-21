import { describe, it, expect, vi } from "vitest";

vi.mock("../css-source-cache", () => ({
  getMatchingRules: () => [],
  getRawDeclarationsFor: () => null,
}));

import {
  resolveVarChain,
  INTERESTING_PROPS,
  tokenizeEditableText,
  serializeEditableTokens,
  classifyEditableChildren,
} from "../css-resolve";

describe("INTERESTING_PROPS", () => {
  it("주요 CSS 속성 포함", () => {
    expect(INTERESTING_PROPS).toContain("color");
    expect(INTERESTING_PROPS).toContain("font-size");
    expect(INTERESTING_PROPS).toContain("padding-top");
    expect(INTERESTING_PROPS).toContain("border-radius");
    expect(INTERESTING_PROPS).toContain("display");
  });

  it("충분한 수의 속성", () => {
    expect(INTERESTING_PROPS.length).toBeGreaterThanOrEqual(30);
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
