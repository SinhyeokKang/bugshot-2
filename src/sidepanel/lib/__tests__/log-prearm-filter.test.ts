import { describe, it, expect } from "vitest";
import { shouldDropPreArmEntry } from "../log-prearm-filter";

// reload는 logClear → lastLogClearAt 세팅 → 그 전 타임스탬프 엔트리를 머지에서 폐기한다.
// pre-arm 초반 로그는 정의상 경계보다 과거라 마커(preArm)로 우회 보존해야 한다.
// shouldDropPreArmEntry(timestamp, lastLogClearAt, isPreArm): 폐기 여부.
describe("shouldDropPreArmEntry", () => {
  it("비-pre-arm 엔트리가 경계보다 과거면 폐기", () => {
    expect(shouldDropPreArmEntry(50, 100, false)).toBe(true);
  });

  it("pre-arm 엔트리는 경계보다 과거여도 보존(우회)", () => {
    expect(shouldDropPreArmEntry(50, 100, true)).toBe(false);
  });

  it("lastLogClearAt이 0이면(클리어 없음) 항상 보존", () => {
    expect(shouldDropPreArmEntry(50, 0, false)).toBe(false);
  });

  it("경계보다 미래(이후) 엔트리는 보존", () => {
    expect(shouldDropPreArmEntry(150, 100, false)).toBe(false);
  });

  it("경계값과 같은 타임스탬프는 보존(>= 경계는 유지)", () => {
    expect(shouldDropPreArmEntry(100, 100, false)).toBe(false);
  });
});
