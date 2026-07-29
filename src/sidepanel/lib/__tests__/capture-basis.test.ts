import { describe, it, expect } from "vitest";

import { resolveCaptureRect, shouldExpandAfter } from "../capture-basis";
import type { CaptureContext } from "@/types/picker";

const VIEWPORT = { width: 1000, height: 800 };
const BEFORE_RECT = { x: 10, y: 20, width: 300, height: 200 };

function contextWith(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    contextSelector: '[role="dialog"]#dlg',
    rect: BEFORE_RECT,
    viewport: VIEWPORT,
    scrollX: 0,
    scrollY: 120,
    ...overrides,
  };
}

function args(
  overrides: Partial<Parameters<typeof resolveCaptureRect>[0]> = {},
) {
  return {
    rect: { x: 0, y: 0, width: 0, height: 0 },
    viewport: VIEWPORT,
    scrollX: 0,
    scrollY: 120,
    context: contextWith(),
    frameId: 0,
    ...overrides,
  };
}

describe("resolveCaptureRect", () => {
  it("rect가 정상이면 그대로 쓴다", () => {
    const rect = { x: 5, y: 5, width: 100, height: 50 };
    expect(resolveCaptureRect(args({ rect }))).toEqual(rect);
  });

  it("0×0이고 scroll·viewport가 전부 같으면 before rect로 대체한다", () => {
    expect(resolveCaptureRect(args())).toEqual(BEFORE_RECT);
  });

  it("scrollY가 다르면 stale rect를 쓰지 않고 null", () => {
    expect(resolveCaptureRect(args({ scrollY: 400 }))).toBeNull();
  });

  it("scrollX가 다르면 null", () => {
    expect(resolveCaptureRect(args({ scrollX: 30 }))).toBeNull();
  });

  it("viewport 크기가 다르면 null — 배율이 어긋난다", () => {
    expect(
      resolveCaptureRect(args({ viewport: { width: 900, height: 800 } })),
    ).toBeNull();
  });

  it("iframe(frameId≠0)이면 기준계가 섞이므로 재사용하지 않는다", () => {
    expect(resolveCaptureRect(args({ frameId: 3 }))).toBeNull();
  });

  it("context가 없는 스코프 밖 경로는 0×0이어도 현행대로 rect를 그대로 넘긴다", () => {
    const rect = { x: 0, y: 0, width: 0, height: 0 };
    expect(resolveCaptureRect(args({ rect, context: undefined }))).toEqual(rect);
  });

  it("한 변만 0이어도 폴백한다 — height:0 편집이 마진 조각으로 저장되면 안 된다", () => {
    const rect = { x: 10, y: 10, width: 120, height: 0 };
    expect(resolveCaptureRect(args({ rect }))).toEqual(BEFORE_RECT);
  });

  it("한 변만 0인데 좌표를 못 믿으면 null", () => {
    const rect = { x: 10, y: 10, width: 120, height: 0 };
    expect(resolveCaptureRect(args({ rect, scrollY: 400 }))).toBeNull();
  });
});

describe("shouldExpandAfter", () => {
  it("before가 확장에 성공했으면 after도 확장 판정을 돌린다", () => {
    expect(shouldExpandAfter(contextWith())).toBe(true);
  });

  it("before가 게이트에서 떨어졌으면 after도 확장하지 않는다", () => {
    expect(shouldExpandAfter(contextWith({ contextSelector: null }))).toBe(false);
  });

  it("before 기준 자체가 없으면 확장하지 않는다", () => {
    expect(shouldExpandAfter(null)).toBe(false);
  });
});
