import { describe, it, expect } from "vitest";

import { clampCropRect } from "../crop-rect";

describe("clampCropRect", () => {
  const IMG_W = 1000;
  const IMG_H = 800;

  it("경계 내부 rect는 그대로 반환 (기존 드래그 크롭 무영향)", () => {
    expect(clampCropRect({ x: 100, y: 50, width: 400, height: 300 }, IMG_W, IMG_H)).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 300,
    });
  });

  it("이미지 경계와 정확히 일치하는 rect는 그대로 반환", () => {
    expect(clampCropRect({ x: 0, y: 0, width: IMG_W, height: IMG_H }, IMG_W, IMG_H)).toEqual({
      x: 0,
      y: 0,
      width: IMG_W,
      height: IMG_H,
    });
  });

  it("width가 우측을 넘으면 남은 영역으로 잘림 (줌 ≠ 100% 빈 픽셀 방지)", () => {
    expect(clampCropRect({ x: 800, y: 0, width: 400, height: 100 }, IMG_W, IMG_H)).toEqual({
      x: 800,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("height가 하단을 넘으면 남은 영역으로 잘림", () => {
    expect(clampCropRect({ x: 0, y: 700, width: 100, height: 400 }, IMG_W, IMG_H)).toEqual({
      x: 0,
      y: 700,
      width: 100,
      height: 100,
    });
  });

  it("x/y가 음수면 0으로 보정하고 넘친 만큼 width/height를 줄인다", () => {
    expect(clampCropRect({ x: -50, y: -20, width: 200, height: 100 }, IMG_W, IMG_H)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 80,
    });
  });

  it("rect가 이미지 완전 바깥이면 최소 1×1 (canvas 0 크기 방지)", () => {
    const r = clampCropRect({ x: 5000, y: 5000, width: 100, height: 100 }, IMG_W, IMG_H);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
    expect(r.x).toBeLessThanOrEqual(IMG_W);
    expect(r.y).toBeLessThanOrEqual(IMG_H);
  });

  it("이미지 크기가 0 이하면 rect를 그대로 반환 (방어)", () => {
    const rect = { x: 10, y: 10, width: 100, height: 100 };
    expect(clampCropRect(rect, 0, 0)).toEqual(rect);
    expect(clampCropRect(rect, -1, IMG_H)).toEqual(rect);
  });
});
