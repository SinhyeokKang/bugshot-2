import { describe, it, expect } from "vitest";
import { diffClassTokens, segmentsToMarkdown } from "../classDiff";

describe("diffClassTokens", () => {
  it("토큰 추가 → 추가된 토큰만 to-be에서 changed", () => {
    const { asIs, toBe } = diffClassTokens(["a", "b"], ["a", "b", "c"]);
    expect(asIs).toEqual([
      { text: "a", changed: false },
      { text: "b", changed: false },
    ]);
    expect(toBe).toEqual([
      { text: "a", changed: false },
      { text: "b", changed: false },
      { text: "c", changed: true },
    ]);
  });

  it("토큰 치환(수정) → 제거된 old는 as-is, 추가된 new는 to-be에서 changed", () => {
    // text-blue-500 → text-red-500: 토큰 단위라 토큰 전체가 changed
    const { asIs, toBe } = diffClassTokens(
      ["text-blue-500", "p-4"],
      ["text-red-500", "p-4"],
    );
    expect(asIs).toEqual([
      { text: "text-blue-500", changed: true },
      { text: "p-4", changed: false },
    ]);
    expect(toBe).toEqual([
      { text: "text-red-500", changed: true },
      { text: "p-4", changed: false },
    ]);
  });

  it("토큰 제거 → 제거된 토큰은 as-is에서 changed", () => {
    const { asIs, toBe } = diffClassTokens(["a", "b", "c"], ["a"]);
    expect(asIs).toEqual([
      { text: "a", changed: false },
      { text: "b", changed: true },
      { text: "c", changed: true },
    ]);
    expect(toBe).toEqual([{ text: "a", changed: false }]);
  });

  it("같은 토큰 집합, 순서만 다름 → 집합 기준이라 강조 없음(원본 순서 보존)", () => {
    const { asIs, toBe } = diffClassTokens(["c", "a", "b"], ["a", "b", "c"]);
    expect(asIs).toEqual([
      { text: "c", changed: false },
      { text: "a", changed: false },
      { text: "b", changed: false },
    ]);
    expect(toBe).toEqual([
      { text: "a", changed: false },
      { text: "b", changed: false },
      { text: "c", changed: false },
    ]);
  });

  it("빈 as-is → 추가만(전부 to-be changed)", () => {
    const { asIs, toBe } = diffClassTokens([], ["a", "b"]);
    expect(asIs).toEqual([]);
    expect(toBe).toEqual([
      { text: "a", changed: true },
      { text: "b", changed: true },
    ]);
  });

  it("빈 to-be → 제거만(전부 as-is changed)", () => {
    const { asIs, toBe } = diffClassTokens(["a", "b"], []);
    expect(asIs).toEqual([
      { text: "a", changed: true },
      { text: "b", changed: true },
    ]);
    expect(toBe).toEqual([]);
  });

  it("완전 동일 → 양쪽 모두 changed 없음", () => {
    const { asIs, toBe } = diffClassTokens(["a", "b"], ["a", "b"]);
    expect(asIs).toEqual([
      { text: "a", changed: false },
      { text: "b", changed: false },
    ]);
    expect(toBe).toEqual([
      { text: "a", changed: false },
      { text: "b", changed: false },
    ]);
  });
});

describe("segmentsToMarkdown", () => {
  it("changed 토큰을 **볼드**로 감싸고 공백으로 join", () => {
    expect(
      segmentsToMarkdown([
        { text: "a", changed: false },
        { text: "b", changed: true },
      ]),
    ).toBe("a **b**");
  });

  it("전부 평문 → 그대로 join", () => {
    expect(
      segmentsToMarkdown([
        { text: "a", changed: false },
        { text: "b", changed: false },
      ]),
    ).toBe("a b");
  });

  it("단일 changed 토큰", () => {
    expect(segmentsToMarkdown([{ text: "a", changed: true }])).toBe("**a**");
  });

  it("빈 배열 → 빈 문자열", () => {
    expect(segmentsToMarkdown([])).toBe("");
  });
});
