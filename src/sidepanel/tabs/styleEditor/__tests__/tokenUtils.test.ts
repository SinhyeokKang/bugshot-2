import { describe, it, expect } from "vitest";
import {
  extractTokenRefs,
  isInternalToken,
  isTokenValue,
  tokenFamilyPrefix,
  findTokenValue,
} from "../tokenUtils";
import type { Token } from "@/types/picker";

describe("extractTokenRefs", () => {
  it("단일 var 참조", () => {
    expect(extractTokenRefs("var(--spacing-4)")).toEqual([
      { name: "--spacing-4" },
    ]);
  });

  it("복수 var 참조", () => {
    const refs = extractTokenRefs("var(--color-a) var(--color-b)");
    expect(refs).toHaveLength(2);
    expect(refs[0].name).toBe("--color-a");
    expect(refs[1].name).toBe("--color-b");
  });

  it("뒤쪽 multiplier", () => {
    expect(extractTokenRefs("var(--spacing-2) * 1.5")).toEqual([
      { name: "--spacing-2", multiplier: 1.5 },
    ]);
  });

  it("앞쪽 multiplier", () => {
    expect(extractTokenRefs("2 * var(--spacing-2)")).toEqual([
      { name: "--spacing-2", multiplier: 2 },
    ]);
  });

  it("음수 multiplier", () => {
    expect(extractTokenRefs("var(--spacing-2) * -1")).toEqual([
      { name: "--spacing-2", multiplier: -1 },
    ]);
  });

  it("--tw- 내부 토큰 필터링", () => {
    expect(extractTokenRefs("var(--tw-ring-color)")).toEqual([]);
  });

  it("빈 값", () => {
    expect(extractTokenRefs("")).toEqual([]);
    expect(extractTokenRefs("16px")).toEqual([]);
  });

  it("var 안에 fallback이 있어도 이름만 추출", () => {
    const refs = extractTokenRefs("var(--color-primary, #000)");
    expect(refs).toEqual([{ name: "--color-primary" }]);
  });

  it("중첩 var fallback은 primary만 추출(fallback 토큰 제외)", () => {
    expect(extractTokenRefs("var(--x, var(--y))")).toEqual([{ name: "--x" }]);
  });

  it("top-level var 둘은 모두 추출", () => {
    expect(extractTokenRefs("calc(var(--a) + var(--b))")).toEqual([
      { name: "--a" },
      { name: "--b" },
    ]);
  });

  it("선행점 소수 multiplier(.5)", () => {
    expect(extractTokenRefs("calc(.5 * var(--g))")).toEqual([
      { name: "--g", multiplier: 0.5 },
    ]);
  });

  it("--_ private alias 토큰 필터링", () => {
    expect(extractTokenRefs("var(--_internal)")).toEqual([]);
  });
});

describe("isInternalToken", () => {
  it("--tw- 접두사는 internal", () => {
    expect(isInternalToken("--tw-ring-color")).toBe(true);
    expect(isInternalToken("--tw-shadow")).toBe(true);
  });

  it("--_ 접두사도 internal (private alias)", () => {
    expect(isInternalToken("--_internal")).toBe(true);
    expect(isInternalToken("--_x")).toBe(true);
  });

  it("그 외는 external", () => {
    expect(isInternalToken("--color-primary")).toBe(false);
    expect(isInternalToken("--spacing-4")).toBe(false);
  });
});

describe("isTokenValue", () => {
  it("var( 포함", () => {
    expect(isTokenValue("var(--spacing-4)")).toBe(true);
  });

  it("괄호/공백/콤마 뒤 var( 도 토큰", () => {
    expect(isTokenValue("calc(var(--x) + 2px)")).toBe(true);
    expect(isTokenValue("0 0 var(--shadow)")).toBe(true);
  });

  it("var( 미포함", () => {
    expect(isTokenValue("16px")).toBe(false);
    expect(isTokenValue("")).toBe(false);
  });

  it("단어 중간 var( 오탐 방지", () => {
    expect(isTokenValue("avar(--x)")).toBe(false);
  });
});

describe("tokenFamilyPrefix", () => {
  const tokens: Token[] = [
    { name: "--color-primary", value: "#000", category: "color" },
    { name: "--color-secondary", value: "#fff", category: "color" },
    { name: "--color-text", value: "#333", category: "color" },
    { name: "--spacing-4", value: "16px", category: "length" },
    { name: "--spacing-8", value: "32px", category: "length" },
  ];

  it("2개 이상 매칭되는 prefix 반환", () => {
    expect(tokenFamilyPrefix("--color-primary", tokens)).toBe("--color-");
  });

  it("매칭 없으면 null", () => {
    expect(tokenFamilyPrefix("--unique-token", tokens)).toBeNull();
  });

  it("짧은 이름", () => {
    expect(tokenFamilyPrefix("--x", tokens)).toBeNull();
  });
});

describe("findTokenValue", () => {
  const tokens: Token[] = [
    { name: "--spacing-4", value: "16px", category: "length" },
  ];

  it("존재하는 토큰", () => {
    expect(findTokenValue(tokens, "--spacing-4")).toBe("16px");
  });

  it("없는 토큰", () => {
    expect(findTokenValue(tokens, "--spacing-8")).toBeUndefined();
  });
});
