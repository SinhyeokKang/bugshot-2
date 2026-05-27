import { describe, expect, it } from "vitest";

import { findActiveIndex, toVideoSeconds } from "../timeline";

describe("findActiveIndex — currentMs 이하 중 가장 늦은 항목의 인덱스", () => {
  it("정렬 입력에서 currentMs 이하 최댓값 인덱스", () => {
    // 250 이하 최댓값은 200 (인덱스 1)
    expect(findActiveIndex([100, 200, 300], 250)).toBe(1);
  });

  it("currentMs가 모든 항목보다 작으면 -1", () => {
    expect(findActiveIndex([100, 200, 300], 50)).toBe(-1);
  });

  it("경계값 포함 (currentMs == timestamp)", () => {
    expect(findActiveIndex([100, 200, 300], 300)).toBe(2);
  });

  it("빈 배열은 -1", () => {
    expect(findActiveIndex([], 100)).toBe(-1);
  });

  it("동일 timestamp 다발이면 마지막 인덱스 (계약 고정)", () => {
    expect(findActiveIndex([100, 100, 100], 100)).toBe(2);
  });

  it("비정렬 입력에서도 올바른 원본 인덱스 반환", () => {
    // 250 이하 항목: 100(idx1), 200(idx2) → 최댓값 200은 인덱스 2
    expect(findActiveIndex([300, 100, 200], 250)).toBe(2);
  });
});

describe("toVideoSeconds — 절대 timestamp를 영상 초로", () => {
  it("(absTs - baseMs) / 1000", () => {
    expect(toVideoSeconds(5000, 2000)).toBe(3);
  });

  it("base와 동일하면 0", () => {
    expect(toVideoSeconds(2000, 2000)).toBe(0);
  });

  it("음수는 0으로 clamp", () => {
    expect(toVideoSeconds(1000, 2000)).toBe(0);
  });
});
