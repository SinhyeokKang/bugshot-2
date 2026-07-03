import { describe, it, expect } from "vitest";
import { shouldInsertHrAfterBreak } from "../hrInputRule";

describe("shouldInsertHrAfterBreak", () => {
  it("`---` 바로 앞이 hardBreak면 수평선으로 변환한다", () => {
    expect(shouldInsertHrAfterBreak({ nodeBeforeTypeName: "hardBreak" })).toBe(true);
  });

  it("앞이 텍스트면(abc---) 변환하지 않는다", () => {
    expect(shouldInsertHrAfterBreak({ nodeBeforeTypeName: "text" })).toBe(false);
  });

  it("앞 노드가 없으면(블록 맨 앞, StarterKit 기본 규칙 담당) 변환하지 않는다", () => {
    expect(shouldInsertHrAfterBreak({ nodeBeforeTypeName: null })).toBe(false);
  });

  it("앞이 다른 노드(image 등)면 변환하지 않는다", () => {
    expect(shouldInsertHrAfterBreak({ nodeBeforeTypeName: "image" })).toBe(false);
  });
});
