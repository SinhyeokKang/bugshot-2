import { describe, it, expect } from "vitest";
import {
  supportsConsoleNetworkLog,
  supportsActionLog,
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
