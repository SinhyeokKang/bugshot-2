import { describe, it, expect } from "vitest";
import {
  supportsConsoleNetworkLog,
  supportsActionLog,
  resolveCapturedLog,
  EMPTY_CONSOLE_LOG,
  EMPTY_NETWORK_LOG,
  EMPTY_ACTION_LOG,
} from "../captureLogSupport";

describe("supportsConsoleNetworkLog", () => {
  it("element만 미지원, screenshot/freeform/video는 지원", () => {
    expect(supportsConsoleNetworkLog("element")).toBe(false);
    expect(supportsConsoleNetworkLog("screenshot")).toBe(true);
    expect(supportsConsoleNetworkLog("freeform")).toBe(true);
    expect(supportsConsoleNetworkLog("video")).toBe(true);
  });

  it("undefined은 false (보수적)", () => {
    expect(supportsConsoleNetworkLog(undefined)).toBe(false);
  });
});

describe("supportsActionLog", () => {
  // 계약 변경(v1.5.8): 액션 로그를 video 전용에서 console/network와 동일 스코프로 확장.
  // 캡처 방식과 무관하게 "무엇을 했는지"는 재현에 필요하다 — element만 로그 전무.
  it("element만 미지원, screenshot/freeform/video는 지원", () => {
    expect(supportsActionLog("element")).toBe(false);
    expect(supportsActionLog("screenshot")).toBe(true);
    expect(supportsActionLog("freeform")).toBe(true);
    expect(supportsActionLog("video")).toBe(true);
  });

  it("undefined은 false", () => {
    expect(supportsActionLog(undefined)).toBe(false);
  });

  it("console/network와 동일한 지원 스코프 (세 로그가 같은 시계 위에 올라간다)", () => {
    for (const mode of ["element", "screenshot", "freeform", "video"] as const) {
      expect(supportsActionLog(mode)).toBe(supportsConsoleNetworkLog(mode));
    }
  });
});

describe("resolveCapturedLog", () => {
  const raw = { totalSeen: 3, captured: 3 } as unknown as {
    totalSeen: number;
  };
  const empty = { totalSeen: 0, captured: 0 } as unknown as {
    totalSeen: number;
  };

  it("미지원이면 raw가 있어도 null", () => {
    expect(resolveCapturedLog(raw, false, empty)).toBeNull();
  });

  it("미지원이면 raw가 없어도 null", () => {
    expect(resolveCapturedLog(null, false, empty)).toBeNull();
  });

  it("지원 + raw 존재 → raw 그대로(동일 참조)", () => {
    expect(resolveCapturedLog(raw, true, empty)).toBe(raw);
  });

  it("지원 + raw null → empty (0건이 null이 아니라 빈 객체)", () => {
    expect(resolveCapturedLog(null, true, empty)).toBe(empty);
  });

  it("지원 + raw undefined → empty", () => {
    expect(resolveCapturedLog(undefined, true, empty)).toBe(empty);
  });
});

describe("빈 로그 상수", () => {
  it("EMPTY_CONSOLE_LOG는 totalSeen·captured 0 + 빈 entries", () => {
    expect(EMPTY_CONSOLE_LOG.totalSeen).toBe(0);
    expect(EMPTY_CONSOLE_LOG.captured).toBe(0);
    expect(EMPTY_CONSOLE_LOG.entries).toEqual([]);
  });

  it("EMPTY_NETWORK_LOG는 totalSeen·captured 0 + 빈 warnings·requests", () => {
    expect(EMPTY_NETWORK_LOG.totalSeen).toBe(0);
    expect(EMPTY_NETWORK_LOG.captured).toBe(0);
    expect(EMPTY_NETWORK_LOG.warnings).toEqual([]);
    expect(EMPTY_NETWORK_LOG.requests).toEqual([]);
  });

  it("EMPTY_ACTION_LOG는 totalSeen·captured 0 + 빈 entries", () => {
    expect(EMPTY_ACTION_LOG.totalSeen).toBe(0);
    expect(EMPTY_ACTION_LOG.captured).toBe(0);
    expect(EMPTY_ACTION_LOG.entries).toEqual([]);
  });
});
