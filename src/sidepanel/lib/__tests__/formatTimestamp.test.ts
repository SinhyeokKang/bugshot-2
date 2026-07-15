import { describe, expect, it, vi } from "vitest";

// dateBcp47만 의존 — 로케일을 고정해 포맷을 결정적으로.
vi.mock("@/i18n", () => ({
  dateBcp47: () => "en-US",
}));

import { formatTimestamp } from "../formatTimestamp";

describe("formatTimestamp", () => {
  it("숫자 타임스탬프를 사람이 읽을 수 있는 문자열로 변환", () => {
    const result = formatTimestamp(1700000000000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("연/월/일/시/분/초를 포함", () => {
    const d = new Date(2024, 0, 15, 10, 30, 45);
    const result = formatTimestamp(d.getTime());
    expect(result).toContain("2024");
    expect(result).toContain("15");
    expect(result).toContain("30");
    expect(result).toContain("45");
  });

  // 회귀: 글로벌 팀이 Captured 시각의 타임존을 판독할 수 있어야 한다.
  // 리포터 브라우저 로컬 TZ의 GMT 오프셋이 출력에 포함(실행 환경 TZ 무관 — UTC면 "GMT",
  // 그 외 "GMT+9" 등. 하드코딩 로컬시각 비교는 환경 TZ 의존이라 금지).
  it("리포터 로컬 타임존 오프셋(GMT)을 포함한다", () => {
    const result = formatTimestamp(1700000000000);
    expect(result).toMatch(/GMT/);
  });
});
