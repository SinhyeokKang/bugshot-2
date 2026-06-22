import { describe, expect, it } from "vitest";
import { NAMED_COLORS } from "../named-colors";

describe("NAMED_COLORS", () => {
  it("대표 CSS named color를 포함", () => {
    for (const c of ["red", "blue", "rebeccapurple", "lightgoldenrodyellow"]) {
      expect(NAMED_COLORS.has(c)).toBe(true);
    }
  });

  it("transparent는 포함, currentcolor는 의도적으로 제외", () => {
    expect(NAMED_COLORS.has("transparent")).toBe(true);
    expect(NAMED_COLORS.has("currentcolor")).toBe(false);
  });

  it("색이 아닌 값은 미포함", () => {
    for (const v of ["notacolor", "#fff", "rgb(0,0,0)", ""]) {
      expect(NAMED_COLORS.has(v)).toBe(false);
    }
  });

  it("모든 항목이 소문자 canonical (대소문자는 사용처에서 toLowerCase로 정규화)", () => {
    for (const c of NAMED_COLORS) {
      expect(c).toBe(c.toLowerCase());
    }
  });
});
