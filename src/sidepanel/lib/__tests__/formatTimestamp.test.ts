import { describe, expect, it } from "vitest";
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
});
