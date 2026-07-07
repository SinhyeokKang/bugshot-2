import { describe, it, expect } from "vitest";
import { swatchColorFor } from "../cssSwatch";

// CSS.supports를 주입해 jsdom 의존 없이 검증.
const fakeSupports = (c: string) =>
  ["red", "blue", "#fff", "transparent", "currentColor", "rgb(0, 0, 0)"].includes(c);

describe("swatchColorFor", () => {
  it("supported color keyword를 그대로 반환", () => {
    expect(swatchColorFor("red", fakeSupports)).toBe("red");
    expect(swatchColorFor("transparent", fakeSupports)).toBe("transparent");
    expect(swatchColorFor("rgb(0, 0, 0)", fakeSupports)).toBe("rgb(0, 0, 0)");
  });

  it("색이 아닌 label은 null", () => {
    expect(swatchColorFor("flex", fakeSupports)).toBeNull();
    expect(swatchColorFor("auto", fakeSupports)).toBeNull();
  });

  it("CSS-wide 키워드는 supports가 true여도 제외", () => {
    expect(swatchColorFor("inherit", () => true)).toBeNull();
    expect(swatchColorFor("unset", () => true)).toBeNull();
    expect(swatchColorFor("REVERT", () => true)).toBeNull();
  });

  it("앞뒤 공백을 trim", () => {
    expect(swatchColorFor("  blue  ", fakeSupports)).toBe("blue");
  });

  it("빈 문자열/공백은 null", () => {
    expect(swatchColorFor("", fakeSupports)).toBeNull();
    expect(swatchColorFor("   ", fakeSupports)).toBeNull();
  });
});
