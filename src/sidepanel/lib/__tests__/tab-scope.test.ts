import { describe, it, expect } from "vitest";
import { isForeignTabMessage } from "../tab-scope";

describe("isForeignTabMessage — 탭 격리 fail-closed", () => {
  it("같은 탭의 메시지는 통과", () => {
    expect(isForeignTabMessage(7, 7)).toBe(false);
  });

  it("다른 탭의 메시지는 드롭", () => {
    expect(isForeignTabMessage(7, 8)).toBe(true);
  });

  it("탭 정보가 없는 내부 통신(사이드패널·background)은 통과", () => {
    expect(isForeignTabMessage(7, undefined)).toBe(false);
    expect(isForeignTabMessage(7, null)).toBe(false);
    expect(isForeignTabMessage(null, undefined)).toBe(false);
  });

  // 이 케이스가 회귀의 핵심 — tabId 미해소 구간에 필터가 전면 해제돼 있었다.
  it("내 tabId가 미해소면 탭 메시지를 드롭한다 (fail-closed)", () => {
    expect(isForeignTabMessage(null, 8)).toBe(true);
    expect(isForeignTabMessage(null, 0)).toBe(true);
  });
});
