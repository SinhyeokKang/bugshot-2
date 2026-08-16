import { describe, it, expect } from "vitest";
import {
  isTopFrame,
  constrainLabelWidth,
  computeLabelPlacement,
} from "../overlay-layout";

function selfRef(): { top: unknown } {
  const w: { top: unknown } = { top: null };
  w.top = w;
  return w;
}

describe("isTopFrame", () => {
  it("자기 자신이 top이면 true", () => {
    expect(isTopFrame(selfRef())).toBe(true);
  });

  it("top이 남이면 false (등록된 1-depth iframe)", () => {
    expect(isTopFrame({ top: selfRef() })).toBe(false);
  });

  it("top이 없으면(접근 불가) false — 배너를 그리지 않는 쪽으로 닫는다", () => {
    expect(isTopFrame({ top: null })).toBe(false);
  });
});

describe("constrainLabelWidth", () => {
  it("뷰포트가 넉넉하면 제약 없음", () => {
    expect(constrainLabelWidth(260, 1440)).toBeNull();
  });

  it("프레임이 라벨보다 좁으면 마진 안쪽 폭으로 줄인다 (145px 프레임)", () => {
    expect(constrainLabelWidth(260, 145)).toBe(129);
  });

  it("라벨이 가용폭과 같으면 제약 없음 (경계)", () => {
    expect(constrainLabelWidth(129, 145)).toBeNull();
  });

  it("마진 두 배보다 좁은 프레임에서도 1px 이상은 남긴다", () => {
    const w = constrainLabelWidth(260, 10);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThanOrEqual(1);
    expect(w!).toBeLessThanOrEqual(10);
  });
});

describe("computeLabelPlacement", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });

  it("기본은 요소 좌상단 위쪽에 붙인다", () => {
    const p = computeLabelPlacement({
      rect: rect(100, 200, 300, 50),
      labelW: 260,
      labelH: 40,
      vpW: 1440,
      vpH: 900,
    });
    expect(p).toEqual({ left: 100, top: 200 - 40 - 2 });
  });

  it("위 공간이 없으면 요소 아래로 내린다", () => {
    const p = computeLabelPlacement({
      rect: rect(100, 4, 300, 50),
      labelW: 260,
      labelH: 40,
      vpW: 1440,
      vpH: 900,
    });
    expect(p.top).toBe(4 + 50 + 2);
  });

  it("위아래 모두 부족하면 상단 마진에 둔다", () => {
    const p = computeLabelPlacement({
      rect: rect(100, 4, 300, 860),
      labelW: 260,
      labelH: 40,
      vpW: 1440,
      vpH: 900,
    });
    expect(p.top).toBe(8);
  });

  it("우측 끝 요소는 우측 정렬로 접는다", () => {
    const p = computeLabelPlacement({
      rect: rect(1300, 200, 100, 50),
      labelW: 260,
      labelH: 40,
      vpW: 1440,
      vpH: 900,
    });
    expect(p.left).toBe(1400 - 260);
  });

  // 실측 회귀: news.naver.com의 145×454 iframe에서 left = -123px이 그대로 나갔다.
  it("프레임이 라벨보다 좁아도 왼쪽으로 넘치지 않는다 (145×454 iframe)", () => {
    const p = computeLabelPlacement({
      rect: rect(20, 100, 100, 30),
      labelW: 260,
      labelH: 120,
      vpW: 145,
      vpH: 454,
    });
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left).toBe(8);
  });

  it("좁은 프레임에서 요소가 우측에 붙어 있어도 left는 음수가 아니다", () => {
    const p = computeLabelPlacement({
      rect: rect(120, 100, 25, 30),
      labelW: 260,
      labelH: 120,
      vpW: 145,
      vpH: 454,
    });
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it("마진 두 배보다 좁은 프레임에서도 left는 음수가 아니다", () => {
    const p = computeLabelPlacement({
      rect: rect(2, 4, 6, 6),
      labelW: 260,
      labelH: 120,
      vpW: 10,
      vpH: 40,
    });
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it("labelW가 이미 가용폭으로 줄어든 뒤에도 같은 좌표를 낸다 (2-pass 일관성)", () => {
    const base = {
      rect: rect(20, 100, 100, 30),
      labelH: 120,
      vpW: 145,
      vpH: 454,
    };
    const wide = computeLabelPlacement({ ...base, labelW: 260 });
    const fitted = computeLabelPlacement({ ...base, labelW: 129 });
    expect(fitted.left).toBe(wide.left);
  });
});
