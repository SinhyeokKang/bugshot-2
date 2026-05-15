import { describe, it, expect } from "vitest";
import { findClosingToken } from "../findClosingToken";

function tok(type: string) {
  return { type };
}

describe("findClosingToken", () => {
  it("단일 open/close 쌍 → close 인덱스 반환", () => {
    const tokens = [tok("open"), tok("inner"), tok("close")];
    expect(findClosingToken(tokens, 0, "open", "close")).toBe(2);
  });

  it("중첩 open/close → 올바른 depth의 close 반환", () => {
    const tokens = [
      tok("open"),
      tok("open"),
      tok("close"),
      tok("close"),
    ];
    expect(findClosingToken(tokens, 0, "open", "close")).toBe(3);
  });

  it("start 위치부터 탐색", () => {
    const tokens = [
      tok("open"),
      tok("close"),
      tok("open"),
      tok("inner"),
      tok("close"),
    ];
    expect(findClosingToken(tokens, 2, "open", "close")).toBe(4);
  });

  it("닫는 토큰 없으면 → 마지막 인덱스 반환", () => {
    const tokens = [tok("open"), tok("inner")];
    expect(findClosingToken(tokens, 0, "open", "close")).toBe(1);
  });

  it("빈 배열 → -1 (length - 1)", () => {
    expect(findClosingToken([], 0, "open", "close")).toBe(-1);
  });
});
