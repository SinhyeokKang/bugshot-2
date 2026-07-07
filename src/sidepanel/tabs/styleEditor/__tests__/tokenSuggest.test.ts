import { describe, it, expect } from "vitest";
import type { Token } from "@/types/picker";
import {
  filterTokensByQuery,
  tokenFamilyPrefixes,
  groupTokensByFamily,
  flattenTokenGroups,
  matchRange,
} from "../tokenSuggest";

const tk = (name: string, value: string, category: Token["category"]): Token => ({
  name,
  value,
  category,
});

const TOKENS: Token[] = [
  tk("--color-blue-500", "#3b82f6", "color"),
  tk("--color-blue-700", "#1d4ed8", "color"),
  tk("--color-red-500", "#ef4444", "color"),
  tk("--space-sm", "8px", "length"),
  tk("--space-md", "16px", "length"),
  tk("--z-modal", "1000", "number"),
  tk("--brand-logo", "url(logo.svg)", "image"),
  tk("--misc", "whatever", "unknown"),
];

describe("filterTokensByQuery (LIKE 매칭)", () => {
  it("빈 query면 전체 반환", () => {
    expect(filterTokensByQuery(TOKENS, "")).toHaveLength(TOKENS.length);
    expect(filterTokensByQuery(TOKENS, "  ")).toHaveLength(TOKENS.length);
  });

  it("name 부분문자열 매칭", () => {
    const r = filterTokensByQuery(TOKENS, "blue");
    expect(r.map((t) => t.name)).toEqual([
      "--color-blue-500",
      "--color-blue-700",
    ]);
  });

  it("value 부분문자열 매칭", () => {
    const r = filterTokensByQuery(TOKENS, "8px");
    expect(r.map((t) => t.name)).toEqual(["--space-sm"]);
  });

  it("대소문자 무시", () => {
    expect(filterTokensByQuery(TOKENS, "BLUE").map((t) => t.name)).toEqual([
      "--color-blue-500",
      "--color-blue-700",
    ]);
  });
});

describe("tokenFamilyPrefixes", () => {
  it("2개 이상 공유하는 접두를 수집", () => {
    expect(tokenFamilyPrefixes(["--color-blue-500"], TOKENS)).toEqual([
      "--color-blue-",
    ]);
  });

  it("중복 접두는 한 번만", () => {
    expect(
      tokenFamilyPrefixes(["--color-blue-500", "--color-blue-700"], TOKENS),
    ).toEqual(["--color-blue-"]);
  });

  it("family 없으면 빈 배열", () => {
    expect(tokenFamilyPrefixes(["--z-modal"], TOKENS)).toEqual([]);
  });
});

describe("groupTokensByFamily", () => {
  it("category로 base를 좁히고 나머지는 extra", () => {
    const g = groupTokensByFamily(TOKENS, "color", []);
    expect(g.familyGroups).toEqual([]);
    expect(g.primary.map((t) => t.name)).toEqual([
      "--color-blue-500",
      "--color-blue-700",
      "--color-red-500",
    ]);
    // extra는 category!=color && category!=unknown
    expect(g.extra.map((t) => t.name)).toEqual([
      "--space-sm",
      "--space-md",
      "--z-modal",
      "--brand-logo",
    ]);
  });

  it("familyPrefixes가 있으면 family 그룹 분리 + primary에서 제외", () => {
    const g = groupTokensByFamily(TOKENS, "color", ["--color-blue-"]);
    expect(g.familyGroups).toHaveLength(1);
    expect(g.familyGroups[0].tokens.map((t) => t.name)).toEqual([
      "--color-blue-500",
      "--color-blue-700",
    ]);
    expect(g.primary.map((t) => t.name)).toEqual(["--color-red-500"]);
  });

  it("category 없으면 전체가 primary, extra 없음", () => {
    const g = groupTokensByFamily(TOKENS, undefined, []);
    expect(g.primary).toHaveLength(TOKENS.length);
    expect(g.extra).toEqual([]);
  });
});

describe("flattenTokenGroups", () => {
  it("family → primary → extra 순으로 평탄화", () => {
    const g = groupTokensByFamily(TOKENS, "color", ["--color-blue-"]);
    expect(flattenTokenGroups(g).map((t) => t.name)).toEqual([
      "--color-blue-500",
      "--color-blue-700",
      "--color-red-500",
      "--space-sm",
      "--space-md",
      "--z-modal",
      "--brand-logo",
    ]);
  });
});

describe("matchRange", () => {
  it("매칭 범위 [start, end] 반환", () => {
    expect(matchRange("--color-blue-500", "--color")).toEqual([0, 7]);
    expect(matchRange("--color-blue-500", "blue")).toEqual([8, 12]);
  });

  it("대소문자 무시", () => {
    expect(matchRange("--color-BLUE", "blue")).toEqual([8, 12]);
  });

  it("빈 query면 빈 배열", () => {
    expect(matchRange("--color", "")).toEqual([]);
  });

  it("매칭 없으면 빈 배열", () => {
    expect(matchRange("--color", "zzz")).toEqual([]);
  });
});
