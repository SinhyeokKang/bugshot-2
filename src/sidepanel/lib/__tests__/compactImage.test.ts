import { describe, it, expect } from "vitest";

import { calcCompactDimensions, shouldCompact } from "../compactImage";

describe("calcCompactDimensions", () => {
  const MAX_W = 1280;

  it("maxWidth 이하 → 원본 치수 그대로", () => {
    expect(calcCompactDimensions(800, 600, MAX_W)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("maxWidth 초과 → 비율 유지 축소", () => {
    const result = calcCompactDimensions(2560, 1440, MAX_W);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it("정확히 maxWidth → 변경 없음", () => {
    expect(calcCompactDimensions(1280, 960, MAX_W)).toEqual({
      width: 1280,
      height: 960,
    });
  });

  it("세로가 긴 이미지 → width 기준 축소, 비율 유지", () => {
    const result = calcCompactDimensions(2560, 7680, MAX_W);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(3840);
  });

  it("소수점 → 정수로 반올림", () => {
    const result = calcCompactDimensions(2000, 1333, MAX_W);
    expect(result.width).toBe(1280);
    expect(Number.isInteger(result.height)).toBe(true);
    expect(result.height).toBe(Math.round(1333 * (1280 / 2000)));
  });
});

describe("shouldCompact", () => {
  it("webp + maxWidth 이하 → false", () => {
    expect(shouldCompact(800, 600, "image/webp")).toBe(false);
  });

  it("webp + maxWidth 초과 → true (리사이즈 필요)", () => {
    expect(shouldCompact(2560, 1440, "image/webp")).toBe(true);
  });

  it("png + maxWidth 이하 → true (형식 변환 필요)", () => {
    expect(shouldCompact(800, 600, "image/png")).toBe(true);
  });

  it("jpeg + maxWidth 이하 → true (형식 변환 필요)", () => {
    expect(shouldCompact(800, 600, "image/jpeg")).toBe(true);
  });

  it("png + maxWidth 초과 → true", () => {
    expect(shouldCompact(2560, 1440, "image/png")).toBe(true);
  });
});
