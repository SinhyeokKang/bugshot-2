import { describe, it, expect } from "vitest";
import { isKnownDefault, PROP_CATEGORY } from "../propMetadata";

describe("isKnownDefault — border 변별 기본값", () => {
  it("border-{side}-width 0px → 기본값", () => {
    expect(isKnownDefault("border-top-width", "0px")).toBe(true);
    expect(isKnownDefault("border-right-width", "0px")).toBe(true);
    expect(isKnownDefault("border-bottom-width", "0px")).toBe(true);
    expect(isKnownDefault("border-left-width", "0px")).toBe(true);
  });

  it("border-style none → 기본값", () => {
    expect(isKnownDefault("border-style", "none")).toBe(true);
  });

  it("border-{side}-color 기본 색 → 기본값", () => {
    expect(isKnownDefault("border-bottom-color", "rgb(0, 0, 0)")).toBe(true);
    expect(isKnownDefault("border-top-color", "currentcolor")).toBe(true);
  });

  it("실제 편집값은 기본값 아님", () => {
    expect(isKnownDefault("border-bottom-width", "2px")).toBe(false);
    expect(isKnownDefault("border-style", "dashed")).toBe(false);
    expect(isKnownDefault("border-top-color", "red")).toBe(false);
  });
});

describe("PROP_CATEGORY — border 변별 longhand", () => {
  it("width longhand → length", () => {
    expect(PROP_CATEGORY["border-top-width"]).toBe("length");
    expect(PROP_CATEGORY["border-right-width"]).toBe("length");
    expect(PROP_CATEGORY["border-bottom-width"]).toBe("length");
    expect(PROP_CATEGORY["border-left-width"]).toBe("length");
  });

  it("color longhand → color", () => {
    expect(PROP_CATEGORY["border-top-color"]).toBe("color");
    expect(PROP_CATEGORY["border-bottom-color"]).toBe("color");
  });
});
