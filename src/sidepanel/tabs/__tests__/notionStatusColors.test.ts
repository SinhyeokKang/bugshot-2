import { describe, expect, it } from "vitest";
import { notionStatusCategory } from "../notionStatusColors";

// Notion status option color → 시각적 카테고리 매핑.
// 기준: green=완료, blue/purple=진행, 그 외=보류/시작전.
describe("notionStatusCategory", () => {
  it("green → done", () => {
    expect(notionStatusCategory("green")).toBe("done");
  });

  it("blue / purple → indeterminate (진행)", () => {
    expect(notionStatusCategory("blue")).toBe("indeterminate");
    expect(notionStatusCategory("purple")).toBe("indeterminate");
  });

  it("gray / brown / default / 그 외 → new (보류/시작전)", () => {
    expect(notionStatusCategory("gray")).toBe("new");
    expect(notionStatusCategory("brown")).toBe("new");
    expect(notionStatusCategory("default")).toBe("new");
    expect(notionStatusCategory("orange")).toBe("new");
    expect(notionStatusCategory("yellow")).toBe("new");
    expect(notionStatusCategory("red")).toBe("new");
    expect(notionStatusCategory("pink")).toBe("new");
  });

  it("undefined/빈문자열 → new", () => {
    expect(notionStatusCategory(undefined)).toBe("new");
    expect(notionStatusCategory("")).toBe("new");
  });

  it("알 수 없는 색상은 new로 fallback", () => {
    expect(notionStatusCategory("rainbow")).toBe("new");
  });
});
