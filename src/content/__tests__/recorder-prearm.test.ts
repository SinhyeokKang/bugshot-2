import { describe, it, expect } from "vitest";
import { isPreArmFlag } from "../recorder-prearm";

// pre-arm 게이트: document_start에서 sessionStorage 플래그를 동기로 읽어 pre-arm 여부 결정.
// 순수 판정부 isPreArmFlag만 단위 검증 (read/set 래퍼는 sessionStorage 부수효과라 제외).
describe("isPreArmFlag", () => {
  it("플래그 값이 정확히 \"1\"이면 pre-arm 활성", () => {
    expect(isPreArmFlag("1")).toBe(true);
  });

  it("플래그가 없으면(null) 비활성", () => {
    expect(isPreArmFlag(null)).toBe(false);
  });

  it("빈 문자열은 비활성", () => {
    expect(isPreArmFlag("")).toBe(false);
  });

  it("\"0\"은 비활성", () => {
    expect(isPreArmFlag("0")).toBe(false);
  });

  it("\"1\" 외의 truthy 문자열(\"true\")은 비활성 — 정확히 \"1\"만 인정", () => {
    expect(isPreArmFlag("true")).toBe(false);
  });
});
