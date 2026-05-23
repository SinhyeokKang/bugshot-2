import { describe, it, expect } from "vitest";

import { formatOsInfo } from "../osInfo";

describe("formatOsInfo", () => {
  it("macOS — 버전 첫 2 세그먼트만 사용", () => {
    expect(formatOsInfo("macOS", "15.2.0")).toBe("macOS 15.2");
  });

  it("macOS — 버전이 빈 문자열이면 플랫폼만", () => {
    expect(formatOsInfo("macOS", "")).toBe("macOS");
  });

  it("macOS — 세그먼트가 2개뿐이면 그대로", () => {
    expect(formatOsInfo("macOS", "14.0")).toBe("macOS 14.0");
  });

  it("Windows — major ≥ 13이면 Windows 11", () => {
    expect(formatOsInfo("Windows", "15.0.0")).toBe("Windows 11");
  });

  it("Windows — major 1-12이면 Windows 10", () => {
    expect(formatOsInfo("Windows", "10.0.0")).toBe("Windows 10");
  });

  it("Windows — major 0이면 Windows", () => {
    expect(formatOsInfo("Windows", "0.0.0")).toBe("Windows");
  });

  it("Windows — 버전이 빈 문자열이면 Windows", () => {
    expect(formatOsInfo("Windows", "")).toBe("Windows");
  });

  it("Linux — 버전 무시", () => {
    expect(formatOsInfo("Linux", "6.1.0")).toBe("Linux");
  });

  it("Chrome OS — 버전 첫 2 세그먼트만 사용", () => {
    expect(formatOsInfo("Chrome OS", "120.0.6099")).toBe("Chrome OS 120.0");
  });

  it("알 수 없는 platform — 그대로 반환", () => {
    expect(formatOsInfo("FreeBSD", "14.0.0")).toBe("FreeBSD");
  });
});
