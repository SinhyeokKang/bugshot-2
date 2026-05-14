import { describe, expect, it } from "vitest";
import {
  ELEMENT_LABEL_MAX_CLASSES,
  formatElementName,
  visibleClasses,
} from "../element-label";

describe("visibleClasses", () => {
  it("MAX 이하면 전부 shown, extra=0", () => {
    const result = visibleClasses(["a", "b"]);
    expect(result.shown).toEqual(["a", "b"]);
    expect(result.extra).toBe(0);
  });

  it("MAX 초과 시 잘리고 extra 반환", () => {
    const classes = Array.from({ length: 6 }, (_, i) => `c${i}`);
    const result = visibleClasses(classes);
    expect(result.shown).toHaveLength(ELEMENT_LABEL_MAX_CLASSES);
    expect(result.extra).toBe(6 - ELEMENT_LABEL_MAX_CLASSES);
  });

  it("빈 배열 → shown=[], extra=0", () => {
    expect(visibleClasses([])).toEqual({ shown: [], extra: 0 });
  });
});

describe("formatElementName", () => {
  it("tag만", () => {
    expect(formatElementName({ tag: "div", classList: [] })).toBe("div");
  });

  it("tag + id", () => {
    expect(formatElementName({ tag: "div", classList: [], id: "app" })).toBe("div#app");
  });

  it("tag + classes", () => {
    expect(formatElementName({ tag: "span", classList: ["btn", "primary"] })).toBe("span.btn.primary");
  });

  it("tag + id + classes", () => {
    expect(
      formatElementName({ tag: "div", classList: ["a", "b"], id: "root" }),
    ).toBe("div#root.a.b");
  });

  it("클래스 MAX 초과 시 +N 표기", () => {
    const classes = ["a", "b", "c", "d", "e"];
    const result = formatElementName({ tag: "div", classList: classes });
    expect(result).toBe("div.a.b.c+2");
  });

  it("brackets=true → 꺾쇠 래핑", () => {
    expect(
      formatElementName({ tag: "p", classList: [], brackets: true }),
    ).toBe("<p>");
  });

  it("id=null → id 생략", () => {
    expect(
      formatElementName({ tag: "div", classList: [], id: null }),
    ).toBe("div");
  });
});
