import { describe, it, expect, vi } from "vitest";

vi.mock("../css-source-cache", () => ({
  getMatchingRules: () => [],
  getRawDeclarationsFor: () => null,
}));

import { resolveVarChain, INTERESTING_PROPS } from "../css-resolve";

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
