import { describe, it, expect } from "vitest";
import { pointsToPath } from "../annotation-draw";

describe("pointsToPath", () => {
  it("다중 포인트 → M으로 시작하고 이후 L 커맨드로 이어진다", () => {
    expect(pointsToPath([
      [0, 0],
      [10, 10],
      [20, 5],
    ])).toBe("M0 0 L10 10 L20 5");
  });

  it("두 포인트 → M + 단일 L", () => {
    expect(pointsToPath([
      [3, 4],
      [7, 8],
    ])).toBe("M3 4 L7 8");
  });

  it("단일 포인트 → 자기 자신으로의 zero-length line (round-cap 점 렌더용)", () => {
    // 점 하나만 찍혀도 round linecap으로 보이게 M x y L x y.
    expect(pointsToPath([[5, 5]])).toBe("M5 5 L5 5");
  });

  it("빈 배열 → 빈 문자열", () => {
    expect(pointsToPath([])).toBe("");
  });

  it("소수 좌표를 그대로 직렬화한다", () => {
    expect(pointsToPath([
      [1.5, 2.25],
      [3, 4.5],
    ])).toBe("M1.5 2.25 L3 4.5");
  });

  it("대량 포인트(수천 개)를 크래시 없이 처리하고 구조가 일관된다", () => {
    const points: Array<[number, number]> = Array.from({ length: 5000 }, (_, i) => [i, i * 2]);
    const d = pointsToPath(points);
    expect(d.startsWith("M0 0 ")).toBe(true);
    // 커맨드 개수: M 1개 + L 4999개.
    expect(d.match(/L/g)?.length).toBe(4999);
    expect(d.endsWith("L4999 9998")).toBe(true);
  });
});
