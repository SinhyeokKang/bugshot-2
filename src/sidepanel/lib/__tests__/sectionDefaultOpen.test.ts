import { describe, expect, it } from "vitest";
import { sectionDefaultOpen } from "../sectionDefaultOpen";

const PROPS = ["margin", "padding"] as const;

describe("sectionDefaultOpen", () => {
  it("specified에 섹션 prop이 있으면 펼친다", () => {
    expect(
      sectionDefaultOpen(PROPS, { margin: "8px" }, {}),
    ).toBe(true);
  });

  it("specified가 있지만(다른 prop) 섹션 prop은 없으면 접는다 — computed로 새지 않음", () => {
    // anySpecified=true 이므로 기존 동작 유지: computed에 값이 있어도 무시
    expect(
      sectionDefaultOpen(
        PROPS,
        { color: "red" },
        { margin: "0px", padding: "0px" },
      ),
    ).toBe(false);
  });

  it("specified가 전무하면 computed 빈값 아닌 prop으로 펼친다 (cross-origin fallback)", () => {
    expect(
      sectionDefaultOpen(PROPS, {}, { margin: "0px" }),
    ).toBe(true);
  });

  it("specified 전무 + computed 값이 빈 문자열이면 접는다", () => {
    expect(
      sectionDefaultOpen(PROPS, {}, { margin: "", padding: "" }),
    ).toBe(false);
  });

  it("specified 전무 + computed에 섹션 prop 키가 없으면 접는다", () => {
    expect(
      sectionDefaultOpen(PROPS, {}, { color: "red" }),
    ).toBe(false);
  });

  it("specified·computed 둘 다 전무하면 접는다", () => {
    expect(sectionDefaultOpen(PROPS, {}, {})).toBe(false);
  });
});
