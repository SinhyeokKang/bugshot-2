import { describe, expect, it } from "vitest";

import { isRepeatedPositionedElement } from "../scroll-capture";

interface PositionedElementCase {
  position: string;
  rectTop: number;
  rectBottom: number;
  flowTop: number;
  flowBottom: number;
  scrollY: number;
  viewportHeight: number;
  topInset: number;
  bottomInset: number;
}

function positioned(overrides: Partial<PositionedElementCase> = {}): PositionedElementCase {
  return {
    position: "sticky",
    rectTop: 0,
    rectBottom: 40,
    flowTop: 100,
    flowBottom: 140,
    scrollY: 600,
    viewportHeight: 600,
    topInset: 0,
    bottomInset: Number.NaN,
    ...overrides,
  };
}

describe("isRepeatedPositionedElement", () => {
  it("fixed 요소는 후속 타일에서 숨긴다", () => {
    expect(isRepeatedPositionedElement(positioned({ position: "fixed" }))).toBe(true);
  });

  it("원래 위치를 지나 상단에 붙은 sticky 요소는 숨긴다", () => {
    expect(isRepeatedPositionedElement(positioned())).toBe(true);
  });

  it("아직 원래 위치에 도달하지 않은 sticky 요소는 숨기지 않는다", () => {
    expect(
      isRepeatedPositionedElement(
        positioned({ rectTop: 300, rectBottom: 340, flowTop: 900, flowBottom: 940 }),
      ),
    ).toBe(false);
  });

  it("이전 타일에서 전체가 노출되지 않은 긴 sticky 요소는 숨기지 않는다", () => {
    expect(
      isRepeatedPositionedElement(
        positioned({ rectBottom: 800, flowTop: 100, flowBottom: 900 }),
      ),
    ).toBe(false);
  });

  it("이전 타일에서 노출된 하단 sticky 요소는 숨긴다", () => {
    expect(
      isRepeatedPositionedElement(
        positioned({
          rectTop: 560,
          rectBottom: 600,
          flowTop: 1500,
          flowBottom: 1540,
          topInset: Number.NaN,
          bottomInset: 0,
        }),
      ),
    ).toBe(true);
  });

  it("뷰포트보다 길어 전체가 노출되지 않은 하단 sticky 요소는 숨기지 않는다", () => {
    expect(
      isRepeatedPositionedElement(
        positioned({
          rectTop: -200,
          rectBottom: 600,
          flowTop: 1000,
          flowBottom: 1800,
          topInset: Number.NaN,
          bottomInset: 0,
        }),
      ),
    ).toBe(false);
  });
});
