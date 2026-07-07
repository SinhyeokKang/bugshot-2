import { describe, it, expect } from "vitest";
import { sameElementKey, elementKey } from "../element-key";

describe("sameElementKey — selector+frameId 복합키", () => {
  it("selector·frameId 모두 같으면 true", () => {
    expect(sameElementKey({ selector: "#a", frameId: 3 }, { selector: "#a", frameId: 3 })).toBe(true);
  });

  it("selector 같아도 frameId 다르면 false (다른 프레임의 동일 selector)", () => {
    expect(sameElementKey({ selector: "#a", frameId: 3 }, { selector: "#a", frameId: 0 })).toBe(false);
  });

  it("frameId 미지정(구버전)은 0과 동일 취급", () => {
    expect(sameElementKey({ selector: "#a" }, { selector: "#a", frameId: 0 })).toBe(true);
    expect(sameElementKey({ selector: "#a", frameId: 0 }, { selector: "#a" })).toBe(true);
    expect(sameElementKey({ selector: "#a" }, { selector: "#a" })).toBe(true);
  });

  it("selector 다르면 frameId 무관 false", () => {
    expect(sameElementKey({ selector: "#a", frameId: 3 }, { selector: "#b", frameId: 3 })).toBe(false);
  });
});

describe("elementKey — 문자열 복합키", () => {
  it("sameElementKey면 elementKey도 일치(frameId 미지정=0)", () => {
    expect(elementKey({ selector: "#a" })).toBe(elementKey({ selector: "#a", frameId: 0 }));
  });

  it("frameId 다르면 다른 키", () => {
    expect(elementKey({ selector: "#a", frameId: 3 })).not.toBe(
      elementKey({ selector: "#a", frameId: 0 }),
    );
  });

  it("selector 다르면 다른 키", () => {
    expect(elementKey({ selector: "#a", frameId: 1 })).not.toBe(
      elementKey({ selector: "#b", frameId: 1 }),
    );
  });
});
