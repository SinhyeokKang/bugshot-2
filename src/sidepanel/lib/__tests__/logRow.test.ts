import { describe, expect, it } from "vitest";
import { formatRelativeTime, syncRowClass } from "../logRow";

describe("formatRelativeTime", () => {
  it("base 대비 초를 MM:SS로", () => {
    expect(formatRelativeTime(1000, 1000)).toBe("00:00");
    expect(formatRelativeTime(66_000, 1000)).toBe("01:05");
    expect(formatRelativeTime(3_661_000, 1000)).toBe("61:00");
  });
  it("반올림", () => {
    expect(formatRelativeTime(1499, 0)).toBe("00:01");
    expect(formatRelativeTime(1500, 0)).toBe("00:02");
  });
  it("음수는 00:00으로 clamp", () => {
    expect(formatRelativeTime(500, 1000)).toBe("00:00");
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
