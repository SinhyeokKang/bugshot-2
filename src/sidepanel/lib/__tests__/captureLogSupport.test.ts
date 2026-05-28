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
  it("video만 지원, 나머지(element/screenshot/freeform)는 미지원", () => {
    expect(supportsActionLog("video")).toBe(true);
    expect(supportsActionLog("element")).toBe(false);
    expect(supportsActionLog("screenshot")).toBe(false);
    expect(supportsActionLog("freeform")).toBe(false);
  });

  it("undefined은 false", () => {
    expect(supportsActionLog(undefined)).toBe(false);
  });
});
