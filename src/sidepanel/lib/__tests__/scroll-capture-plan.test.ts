import { describe, it, expect } from "vitest";

import {
  MAX_SCROLL_TILES,
  MAX_CANVAS_HEIGHT_PX,
  planScrollCapture,
  tileDrawRect,
  tilePixelRect,
} from "../scroll-capture-plan";

import type { PageMetrics } from "@/types/picker";

function metrics(scrollHeight: number, vh = 600, dpr = 1): PageMetrics {
  return { scrollHeight, viewport: { width: 800, height: vh }, devicePixelRatio: dpr };
}

describe("planScrollCapture", () => {
  it("페이지 높이 = 뷰포트 높이 → 타일 1개, truncated false", () => {
    const plan = planScrollCapture(metrics(600));
    expect(plan.tiles).toEqual([{ index: 0, scrollY: 0 }]);
    expect(plan.totalHeight).toBe(600);
    expect(plan.truncated).toBe(false);
  });

  it("페이지 높이가 뷰포트의 2.5배 → 타일 3개, totalHeight는 실제 문서 높이", () => {
    const plan = planScrollCapture(metrics(1500));
    expect(plan.tiles.map((t) => t.scrollY)).toEqual([0, 600, 1200]);
    expect(plan.totalHeight).toBe(1500);
    expect(plan.truncated).toBe(false);
  });

  it("타일 상한(20)을 넘는 긴 페이지 → 20타일에서 잘리고 truncated true", () => {
    const plan = planScrollCapture(metrics(600 * 100));
    expect(plan.tiles).toHaveLength(MAX_SCROLL_TILES);
    expect(plan.totalHeight).toBe(600 * MAX_SCROLL_TILES);
    expect(plan.truncated).toBe(true);
  });

  it("캔버스 높이 한계를 넘으면 타일 수를 더 줄인다 (DPR 반영)", () => {
    // vh 1000 × DPR 2 = 타일당 2000px → 20타일이면 40000px로 한계 초과
    const plan = planScrollCapture(metrics(1000 * 100, 1000, 2));
    expect(plan.tiles.length).toBeLessThan(MAX_SCROLL_TILES);
    expect(plan.totalHeight * 2).toBeLessThanOrEqual(MAX_CANVAS_HEIGHT_PX);
    expect(plan.truncated).toBe(true);
  });

  it("뷰포트 높이 0 → 타일 1개로 강등 (무한 루프 방어)", () => {
    const plan = planScrollCapture(metrics(5000, 0));
    expect(plan.tiles).toHaveLength(1);
  });

  it("scrollHeight 0 → 타일 1개로 강등", () => {
    const plan = planScrollCapture(metrics(0));
    expect(plan.tiles).toHaveLength(1);
    expect(plan.truncated).toBe(false);
  });
});

describe("tileDrawRect", () => {
  it("첫 타일은 이미지 전체를 canvas 최상단에 붙인다", () => {
    const plan = planScrollCapture(metrics(1500));
    expect(tileDrawRect(plan, 0, 0)).toEqual({ srcY: 0, srcHeight: 600, destY: 0 });
  });

  it("중간 타일은 계획 y와 실제 y가 같아 겹침 보정이 없다", () => {
    const plan = planScrollCapture(metrics(1500));
    expect(tileDrawRect(plan, 1, 600)).toEqual({ srcY: 0, srcHeight: 600, destY: 600 });
  });

  it("마지막 타일이 문서 끝에서 클램프되면 겹친 만큼 srcY를 밀어 잘라낸다", () => {
    // scrollHeight 1500, vh 600 → 마지막 타일 계획 y=1200이지만 실제 최대 scrollY는 900
    const plan = planScrollCapture(metrics(1500));
    expect(tileDrawRect(plan, 2, 900)).toEqual({ srcY: 300, srcHeight: 300, destY: 1200 });
  });

  it("destY + srcHeight 누적이 totalHeight와 정확히 일치한다 (중복·누락 없음)", () => {
    const plan = planScrollCapture(metrics(1500));
    const actualYs = [0, 600, 900]; // 마지막은 문서 끝 클램프
    const draws = plan.tiles.map((_, i) => tileDrawRect(plan, i, actualYs[i]));
    const last = draws[draws.length - 1];
    expect(last.destY + last.srcHeight).toBe(plan.totalHeight);
    for (let i = 1; i < draws.length; i++) {
      expect(draws[i].destY).toBe(draws[i - 1].destY + draws[i - 1].srcHeight);
    }
  });

  it("truncated 계획에서는 마지막 타일이 totalHeight를 넘지 않는다", () => {
    const plan = planScrollCapture(metrics(600 * 100));
    const lastIndex = plan.tiles.length - 1;
    const draw = tileDrawRect(plan, lastIndex, plan.tiles[lastIndex].scrollY);
    expect(draw.destY + draw.srcHeight).toBe(plan.totalHeight);
  });
});

describe("tilePixelRect", () => {
  it("배율 1에서는 tileDrawRect와 같은 좌표를 픽셀로 돌려준다", () => {
    const plan = planScrollCapture(metrics(1500));
    expect(tilePixelRect(plan, 1, 600, 1)).toEqual({
      srcY: 0,
      srcHeight: 600,
      destY: 600,
      destHeight: 600,
    });
  });

  it("분수 배율에서도 타일 경계에 틈·겹침이 없다 (destY 연속)", () => {
    const scale = 1.25; // Windows 125% — 높이를 따로 반올림하면 ±1px 틈이 생긴다
    const plan = planScrollCapture(metrics(1500));
    const actualYs = [0, 600, 900];
    const rects = plan.tiles.map((_, i) => tilePixelRect(plan, i, actualYs[i], scale));
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].destY).toBe(rects[i - 1].destY + rects[i - 1].destHeight);
    }
    const last = rects[rects.length - 1];
    expect(last.destY + last.destHeight).toBe(Math.round(plan.totalHeight * scale));
  });

  it("마지막 타일의 겹침 보정이 픽셀 좌표에도 반영된다", () => {
    const plan = planScrollCapture(metrics(1500));
    const r = tilePixelRect(plan, 2, 900, 2);
    expect(r.srcY).toBe(600); // 겹친 300 CSS px × 2
    expect(r.srcHeight).toBe(600);
    expect(r.destY).toBe(2400);
  });
});

describe("tilePixelRect — 출력 다운스케일(destScale ≠ srcScale)", () => {
  it("다운스케일에서도 dest 경계가 연속이고 캔버스 높이와 맞는다", () => {
    const srcScale = 2;
    const destScale = 2 * 0.37; // 출력 픽셀 상한으로 축소된 배율
    const plan = planScrollCapture(metrics(1500));
    const actualYs = [0, 600, 900];
    const rects = plan.tiles.map((_, i) =>
      tilePixelRect(plan, i, actualYs[i], srcScale, destScale),
    );
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].destY).toBe(rects[i - 1].destY + rects[i - 1].destHeight);
    }
    const last = rects[rects.length - 1];
    expect(last.destY + last.destHeight).toBe(Math.round(plan.totalHeight * destScale));
    // src는 캡처 이미지 배율 그대로
    expect(rects[2].srcY).toBe(600);
  });
});
