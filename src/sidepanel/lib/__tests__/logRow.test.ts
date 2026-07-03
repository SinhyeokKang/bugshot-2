import { describe, expect, it } from "vitest";
import { formatMmSs, formatRelativeTime, syncRowClass } from "../logRow";

describe("formatMmSs", () => {
  it("초를 M:SS로 (분·초 분리, 초 2자리 pad)", () => {
    expect(formatMmSs(0)).toBe("0:00");
    expect(formatMmSs(5)).toBe("0:05");
    expect(formatMmSs(65)).toBe("1:05");
    expect(formatMmSs(3600)).toBe("60:00");
  });
  it("소수는 floor", () => {
    expect(formatMmSs(65.9)).toBe("1:05");
  });
  it("음수는 0:00으로 clamp", () => {
    expect(formatMmSs(-3)).toBe("0:00");
  });
});

describe("formatRelativeTime", () => {
  it("base 대비 초를 M:SS로", () => {
    expect(formatRelativeTime(1000, 1000)).toBe("0:00");
    expect(formatRelativeTime(66_000, 1000)).toBe("1:05");
    expect(formatRelativeTime(3_661_000, 1000)).toBe("61:00");
  });
  it("반올림", () => {
    expect(formatRelativeTime(1499, 0)).toBe("0:01");
    expect(formatRelativeTime(1500, 0)).toBe("0:02");
  });
  it("음수는 0:00으로 clamp", () => {
    expect(formatRelativeTime(500, 1000)).toBe("0:00");
  });
});

describe("syncRowClass", () => {
  it("비동기 모드면 baseBg만", () => {
    expect(syncRowClass(false, false, "bg-x")).toBe("bg-x");
    expect(syncRowClass(false, true, "bg-x")).toBe("bg-x");
  });
  it("동기화 + active면 primary 보더 + accent", () => {
    expect(syncRowClass(true, true, "bg-x")).toBe("border-l-2 border-l-primary bg-accent/40");
  });
  it("동기화 + 비active면 transparent 보더 + baseBg", () => {
    expect(syncRowClass(true, false, "bg-x")).toBe("border-l-2 border-l-transparent bg-x");
  });
});
