import { describe, it, expect } from "vitest";
import { shouldPreserveBackgroundLogs } from "../useBackgroundRecorder";

describe("shouldPreserveBackgroundLogs", () => {
  it("drafting phase에서는 보존한다 (사용자가 캡처 자산 편집 중)", () => {
    expect(shouldPreserveBackgroundLogs("drafting")).toBe(true);
  });

  it("previewing phase에서는 보존한다 (제출 직전 화면)", () => {
    expect(shouldPreserveBackgroundLogs("previewing")).toBe(true);
  });

  it("done phase에서는 보존한다 (제출 완료 화면)", () => {
    expect(shouldPreserveBackgroundLogs("done")).toBe(true);
  });

  it("idle phase에서는 폐기한다", () => {
    expect(shouldPreserveBackgroundLogs("idle")).toBe(false);
  });

  it("picking phase에서는 폐기한다", () => {
    expect(shouldPreserveBackgroundLogs("picking")).toBe(false);
  });

  it("styling phase에서는 폐기한다", () => {
    expect(shouldPreserveBackgroundLogs("styling")).toBe(false);
  });

  it("capturing phase에서는 폐기한다", () => {
    expect(shouldPreserveBackgroundLogs("capturing")).toBe(false);
  });

  it("recording phase에서는 보존한다 (사용자가 버그 시나리오 재현 중 페이지 이동)", () => {
    expect(shouldPreserveBackgroundLogs("recording")).toBe(true);
  });
});
