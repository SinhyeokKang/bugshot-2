import { describe, it, expect } from "vitest";
import { shouldResyncDoc } from "../docSync";

describe("shouldResyncDoc", () => {
  it("비포커스·평시엔 재동기화한다", () => {
    expect(shouldResyncDoc({ focused: false, aiApplied: false })).toBe(true);
  });

  it("포커스 중 평시엔 스킵한다 (타이핑 커서 튐 방지)", () => {
    expect(shouldResyncDoc({ focused: true, aiApplied: false })).toBe(false);
  });

  it("포커스 중이어도 AI 적용 직후엔 강행한다 (갭1 회귀: stale doc 덮어쓰기 방지)", () => {
    expect(shouldResyncDoc({ focused: true, aiApplied: true })).toBe(true);
  });

  it("비포커스·AI 적용도 재동기화한다", () => {
    expect(shouldResyncDoc({ focused: false, aiApplied: true })).toBe(true);
  });
});
