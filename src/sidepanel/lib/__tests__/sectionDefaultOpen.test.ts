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

  // cross-origin 부분 보강: 보강이 다른 섹션 prop만 채우면(여기선 color) 이 섹션은
  // anySpecified=true 분기로 접힌다. design.md 위험요소에 명시된 수용된 트레이드오프 —
  // 보강 전(specified 전무) computed fallback으로 열려 있던 게 보강 후 접힐 수 있음을 락.
  it("cross-origin 부분 보강 — 미보강 섹션은 접힌다(수용된 트레이드오프)", () => {
    expect(
      sectionDefaultOpen(PROPS, { color: "var(--brand)" }, { margin: "8px" }),
    ).toBe(false);
  });

  it("cross-origin 보강 실패(specified 전무) — computed fallback 유지", () => {
    expect(
      sectionDefaultOpen(PROPS, {}, { margin: "8px", padding: "4px" }),
    ).toBe(true);
  });
});
