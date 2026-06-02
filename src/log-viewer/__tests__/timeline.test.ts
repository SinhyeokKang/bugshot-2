import { describe, expect, it } from "vitest";

import { clampTooltipLeft, findActiveIndex, formatPlayerTime, toVideoSeconds } from "../timeline";

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

describe("formatPlayerTime — 초를 M:SS 형식으로", () => {
  it("65초 → '1:05'", () => {
    expect(formatPlayerTime(65)).toBe("1:05");
  });

  it("0초 → '0:00'", () => {
    expect(formatPlayerTime(0)).toBe("0:00");
  });

  it("59초 → '0:59'", () => {
    expect(formatPlayerTime(59)).toBe("0:59");
  });

  it("600초(10분) → '10:00'", () => {
    expect(formatPlayerTime(600)).toBe("10:00");
  });

  it("소수점 버림: 65.9 → '1:05'", () => {
    expect(formatPlayerTime(65.9)).toBe("1:05");
  });

  it("NaN → '0:00'", () => {
    expect(formatPlayerTime(NaN)).toBe("0:00");
  });

  it("Infinity → '0:00'", () => {
    expect(formatPlayerTime(Infinity)).toBe("0:00");
  });

  it("음수 → '0:00'", () => {
    expect(formatPlayerTime(-10)).toBe("0:00");
  });
});

describe("clampTooltipLeft — 툴팁 박스를 뷰포트 안으로 clamp", () => {
  it("중앙에 여유 있으면 centerX - width/2 그대로", () => {
    // 중앙 500, 폭 100 → left 450, 양쪽 여유
    expect(clampTooltipLeft(500, 100, 1000)).toBe(450);
  });

  it("좌측 엣지(재생 초반): margin으로 clamp", () => {
    // centerX 10, 폭 100 → 원래 -40, margin 8로 clamp
    expect(clampTooltipLeft(10, 100, 1000)).toBe(8);
  });

  it("우측 엣지: viewportWidth - margin - width로 clamp", () => {
    // centerX 990, 폭 100, vw 1000 → 원래 940, max = 1000-8-100=892
    expect(clampTooltipLeft(990, 100, 1000)).toBe(892);
  });

  it("뷰포트보다 넓은 툴팁은 좌측 margin 고정", () => {
    // 폭 1200 > vw 1000 → max 음수, margin과 비교해 margin
    expect(clampTooltipLeft(500, 1200, 1000)).toBe(8);
  });

  it("margin 커스텀", () => {
    expect(clampTooltipLeft(10, 100, 1000, 16)).toBe(16);
  });
});
