import { describe, it, expect } from "vitest";

import {
  resolveCaptureRect,
  resolveExpandRequest,
  sameCaptureBasis,
} from "../capture-basis";
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

describe("resolveExpandRequest", () => {
  it("context가 없으면 호출부 opt-in을 그대로 쓴다 (before 경로)", () => {
    expect(resolveExpandRequest({ expandContext: true })).toEqual({
      expandContext: true,
    });
  });

  it("opt-in도 context도 없으면 확장하지 않는다", () => {
    expect(resolveExpandRequest({})).toEqual({ expandContext: false });
  });

  it("context가 확장 성공이면 그 조상 selector를 실어 확장을 켠다", () => {
    expect(resolveExpandRequest({ context: contextWith() })).toEqual({
      expandContext: true,
      contextSelector: '[role="dialog"]#dlg',
    });
  });

  it("context가 확장 거부(null selector)면 확장하지 않는다", () => {
    expect(
      resolveExpandRequest({ context: contextWith({ contextSelector: null }) }),
    ).toEqual({ expandContext: false });
  });

  // 모순 조합 차단: 호출부가 expandContext를 켜도 before의 판정이 이긴다. 이게 성립하지
  // 않으면 판정 지점이 호출부마다 하나씩 생겨 문이 여러 개가 된다.
  it("context가 확장을 거부했으면 호출부 opt-in을 무시한다", () => {
    expect(
      resolveExpandRequest({
        expandContext: true,
        context: contextWith({ contextSelector: null }),
      }),
    ).toEqual({ expandContext: false });
  });
});

describe("sameCaptureBasis", () => {
  it("같은 조상으로 확장한 두 기준은 같다 — rect·scroll 차이는 무관", () => {
    expect(
      sameCaptureBasis(
        contextWith(),
        contextWith({ scrollY: 999, rect: { x: 1, y: 2, width: 3, height: 4 } }),
      ),
    ).toBe(true);
  });

  it("확장 대상 조상이 다르면 다른 기준이다", () => {
    expect(
      sameCaptureBasis(contextWith(), contextWith({ contextSelector: "#other" })),
    ).toBe(false);
  });

  it("확장 거부와 기준 없음은 같은 기준이다 — 둘 다 요소 bbox로 찍힌다", () => {
    expect(sameCaptureBasis(contextWith({ contextSelector: null }), null)).toBe(
      true,
    );
    expect(sameCaptureBasis(undefined, null)).toBe(true);
  });

  it("확장 성공과 기준 없음은 다르다", () => {
    expect(sameCaptureBasis(contextWith(), null)).toBe(false);
  });
});
