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
  it("webp + maxWidth 이하 → false (이미 최적 포맷+크기)", () => {
    expect(shouldCompact(800, "image/webp")).toBe(false);
  });

  it("webp + maxWidth 초과 → true (리사이즈 필요)", () => {
    expect(shouldCompact(2560, "image/webp")).toBe(true);
  });

  it("jpeg + maxWidth 이하 → false (이미 lossy, 리사이즈 불필요)", () => {
    expect(shouldCompact(800, "image/jpeg")).toBe(false);
    expect(shouldCompact(100, "image/jpeg")).toBe(false);
    expect(shouldCompact(1280, "image/jpeg")).toBe(false);
  });

  it("jpeg + maxWidth 초과 → true (리사이즈 필요)", () => {
    expect(shouldCompact(1281, "image/jpeg")).toBe(true);
    expect(shouldCompact(2560, "image/jpeg")).toBe(true);
  });

  it("png + maxWidth 이하 → true (lossless→lossy 포맷 변환 이득)", () => {
    expect(shouldCompact(100, "image/png")).toBe(true);
    expect(shouldCompact(800, "image/png")).toBe(true);
  });

  it("png + maxWidth 초과 → true (포맷 변환 + 리사이즈)", () => {
    expect(shouldCompact(2560, "image/png")).toBe(true);
  });
});
