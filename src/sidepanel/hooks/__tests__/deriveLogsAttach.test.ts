import { describe, it, expect } from "vitest";
import { deriveLogsAttach } from "../deriveLogsAttach";

// 구 3플래그 스냅샷 → 단일 logsAttach OR 파생.
// semantic: 하나라도 true → true / 셋 다 false → false / 전부 undefined(신규 스냅샷) → true.
describe("deriveLogsAttach — 레거시 3플래그 OR 파생", () => {
  it("하나라도 true면 true", () => {
    expect(
      deriveLogsAttach({ networkLogAttach: true, consoleLogAttach: false, actionLogAttach: false }),
    ).toBe(true);
  });

  it("셋 다 정의됐고 모두 false면 false", () => {
    expect(
      deriveLogsAttach({ networkLogAttach: false, consoleLogAttach: false, actionLogAttach: false }),
    ).toBe(false);
  });

  it("구 필드가 전부 undefined(신규 스냅샷)면 기본 true", () => {
    expect(deriveLogsAttach({})).toBe(true);
  });

  it("부분 정의(network:false, console:true)면 true", () => {
    expect(
      deriveLogsAttach({ networkLogAttach: false, consoleLogAttach: true }),
    ).toBe(true);
  });

  it("일부만 정의됐고 정의된 값에 true가 없으면 false (전부 undefined만 신규 default)", () => {
    // network만 false 정의, 나머지 undefined → OR 파생상 false.
    // "전부 undefined → true" 예외는 셋 다 부재일 때만 적용된다.
    expect(deriveLogsAttach({ networkLogAttach: false })).toBe(false);
  });
});
