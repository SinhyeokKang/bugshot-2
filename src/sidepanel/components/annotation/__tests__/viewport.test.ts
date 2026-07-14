import { describe, expect, it } from "vitest";
import {
  centerAnchoredScroll,
  fitAllScale,
  fitWidthScale,
  formatZoomPercent,
  MAX_ZOOM,
  normalizeZoom,
  panScroll,
  resolveScale,
  stepZoom,
  ZOOM_PRESETS,
  zoomStops,
} from "../viewport";

describe("상수", () => {
  it("프리셋은 오름차순이고 마지막이 최대 배율이다", () => {
    expect([...ZOOM_PRESETS].sort((a, b) => a - b)).toEqual([...ZOOM_PRESETS]);
    expect(ZOOM_PRESETS[ZOOM_PRESETS.length - 1]).toBe(MAX_ZOOM);
  });
});

describe("fitWidthScale — 폭 맞춤 배율", () => {
  it("이미지가 가용 폭보다 넓으면 폭 기준으로 축소한다", () => {
    expect(fitWidthScale(1074, 390)).toBeCloseTo(0.363, 3);
  });

  it("높이와 무관하게 항상 fit-all 이상이다 — fitAll ≤ fit 불변식", () => {
    const cases: Array<[number, number, number, number]> = [
      [1074, 3730, 390, 600],
      [300, 2000, 390, 600],
      [1000, 400, 390, 600],
      [100, 100, 390, 600],
    ];
    for (const [natW, natH, availW, availH] of cases) {
      expect(fitAllScale(natW, natH, availW, availH)).toBeLessThanOrEqual(
        fitWidthScale(natW, availW),
      );
    }
  });

  it("작은 이미지는 확대하지 않는다(최대 1)", () => {
    expect(fitWidthScale(200, 390)).toBe(1);
  });

  it("natW가 0 이하면 1을 반환한다", () => {
    expect(fitWidthScale(0, 390)).toBe(1);
    expect(fitWidthScale(-100, 390)).toBe(1);
  });

  it("availW가 0 이하면 1을 반환한다 — 첫 렌더의 clientWidth=0에서 음수 배율 방지", () => {
    expect(fitWidthScale(1074, 0)).toBe(1);
    expect(fitWidthScale(1074, -32)).toBe(1);
  });
});

describe("fitAllScale — 전체 조망 배율", () => {
  it("폭 제약이 더 빡세면 폭 기준 축소", () => {
    expect(fitAllScale(1000, 500, 400, 1000)).toBeCloseTo(0.4);
  });

  it("높이 제약이 더 빡세면 높이 기준 축소", () => {
    expect(fitAllScale(500, 1000, 1000, 400)).toBeCloseTo(0.4);
  });

  it("작은 이미지는 확대하지 않는다(최대 1)", () => {
    expect(fitAllScale(100, 100, 400, 400)).toBe(1);
  });

  it("natural 크기가 0 이하면 1을 반환한다", () => {
    expect(fitAllScale(0, 100, 400, 400)).toBe(1);
    expect(fitAllScale(100, 0, 400, 400)).toBe(1);
  });

  it("가용 크기가 0 이하면 1을 반환한다 — 첫 렌더 가드", () => {
    expect(fitAllScale(1074, 3730, 0, 0)).toBe(1);
    expect(fitAllScale(1074, 3730, 390, -1)).toBe(1);
  });

  it("세로로 긴 이미지는 fit-width보다 훨씬 작다", () => {
    const all = fitAllScale(1074, 3730, 390, 600);
    const width = fitWidthScale(1074, 390);
    expect(all).toBeLessThan(width);
    expect(all).toBeCloseTo(600 / 3730, 3);
  });
});

describe("zoomStops — 콤보박스·스텝 배율 목록", () => {
  it("fitAll이 맨 앞에 오고, fit 미만 프리셋은 빠진다", () => {
    const stops = zoomStops(0.363, 0.15);
    expect(stops).toEqual([0.15, 0.363, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
  });

  it("fitAll이 fit과 같으면 중복 제거된다 — 가로가 지배하는 이미지엔 조망 항목이 없다", () => {
    const stops = zoomStops(0.4, 0.4);
    expect(stops).toEqual([0.4, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
  });

  it("fit이 1이면 100% 프리셋이 fit과 합쳐진다", () => {
    expect(zoomStops(1, 1)).toEqual([1, 1.5, 2, 3, 4]);
  });

  it("항상 오름차순이고 fit을 포함한다", () => {
    const stops = zoomStops(0.363, 0.15);
    expect(stops).toContain(0.363);
    expect([...stops].sort((a, b) => a - b)).toEqual(stops);
  });
});

describe("stepZoom — 이웃 스톱으로 이동", () => {
  const stops = zoomStops(0.363, 0.15); // [0.15, 0.363, 0.5, 0.75, 1, 1.5, 2, 3, 4]

  it("fit에서 [+]는 다음 프리셋으로 간다", () => {
    expect(stepZoom(0.363, stops, 1)).toBe(0.5);
  });

  it("fit에서 [-]는 전체(fitAll)로 내려간다", () => {
    expect(stepZoom(0.363, stops, -1)).toBe(0.15);
  });

  it("최대 배율에서 [+]는 현재 값을 유지한다", () => {
    expect(stepZoom(4, stops, 1)).toBe(4);
  });

  it("최소 스톱에서 [-]는 현재 값을 유지한다", () => {
    expect(stepZoom(0.15, stops, -1)).toBe(0.15);
  });

  it("stops에 없는 배율(리사이즈 경합)이어도 가장 가까운 이웃으로 수렴한다", () => {
    expect(stepZoom(0.4, stops, 1)).toBe(0.5);
    expect(stepZoom(0.4, stops, -1)).toBe(0.363);
  });

  it("부동소수 오차가 있어도 같은 스톱으로 취급한다", () => {
    expect(stepZoom(0.363 + 1e-9, stops, 1)).toBe(0.5);
  });
});

describe("resolveScale / normalizeZoom — 줌 의도 ↔ 표시 배율", () => {
  const fit = 0.363;
  const fitAll = 0.15;

  it("null은 fit, \"all\"은 fitAll을 추종한다", () => {
    expect(resolveScale(null, fit, fitAll)).toBe(fit);
    expect(resolveScale("all", fit, fitAll)).toBe(fitAll);
    expect(resolveScale(1, fit, fitAll)).toBe(1);
  });

  it("추종 상태는 fit·fitAll이 바뀌면 따라간다 — 옛 숫자에 고정되지 않는다", () => {
    expect(resolveScale("all", 0.5, 0.2)).toBe(0.2);
    expect(resolveScale(null, 0.5, 0.2)).toBe(0.5);
  });

  it("fit과 같은 배율은 맞춤(null)으로 접힌다", () => {
    expect(normalizeZoom(fit, fit, fitAll)).toBeNull();
    expect(normalizeZoom(fit + 1e-9, fit, fitAll)).toBeNull();
  });

  it("fitAll과 같은 배율은 전체(\"all\")로 접힌다 — 숫자로 저장하면 refit을 못 따라간다", () => {
    expect(normalizeZoom(fitAll, fit, fitAll)).toBe("all");
  });

  it("그 외 배율은 숫자 그대로 고정된다", () => {
    expect(normalizeZoom(1, fit, fitAll)).toBe(1);
  });
});

describe("centerAnchoredScroll — 배율 변경 시 뷰포트 중앙 유지", () => {
  const base = {
    clientWidth: 400,
    clientHeight: 600,
    contentWidth: 1000,
    contentHeight: 2000,
  };

  it("확대해도 중앙에 있던 natural 좌표가 중앙에 남는다", () => {
    const next = centerAnchoredScroll({
      ...base,
      scrollLeft: 0,
      scrollTop: 100,
      oldScale: 0.4,
      newScale: 0.8,
    });
    // 중앙 natural y = (100 + 300) / 0.4 = 1000 → 1000 * 0.8 - 300 = 500
    expect(next.scrollTop).toBeCloseTo(500);
    // 중앙 natural x = (0 + 200) / 0.4 = 500 → 500 * 0.8 - 200 = 200
    expect(next.scrollLeft).toBeCloseTo(200);
  });

  it("축소해도 중앙 지점이 보존된다", () => {
    const next = centerAnchoredScroll({
      ...base,
      scrollLeft: 200,
      scrollTop: 500,
      oldScale: 0.8,
      newScale: 0.4,
    });
    expect(next.scrollTop).toBeCloseTo(100);
    expect(next.scrollLeft).toBeCloseTo(0);
  });

  it("스크롤 여지가 없는 축은 0으로 클램프된다", () => {
    const next = centerAnchoredScroll({
      ...base,
      scrollLeft: 0,
      scrollTop: 0,
      oldScale: 0.2, // content 200x400 — 양축 모두 뷰포트보다 작다
      newScale: 0.3, // content 300x600 — 여전히 작다
    });
    expect(next.scrollLeft).toBe(0);
    expect(next.scrollTop).toBe(0);
  });

  it("계산값이 최대치를 넘으면 최대치로 잘린다", () => {
    // 하단 끝까지 스크롤한 상태에서 축소 → 중앙 유지 계산값이 새 최대치를 초과한다.
    const next = centerAnchoredScroll({
      ...base,
      scrollLeft: 0,
      scrollTop: 1400, // oldScale 1 기준 최대치(2000 - 600)
      oldScale: 1,
      newScale: 0.5, // content 500x1000 → 새 최대치는 1000 - 600 = 400
    });
    expect(next.scrollTop).toBe(400);
  });

  it("oldScale이 0이면 0으로 나누지 않고 {0, 0}을 반환한다", () => {
    const next = centerAnchoredScroll({
      ...base,
      scrollLeft: 10,
      scrollTop: 10,
      oldScale: 0,
      newScale: 0.5,
    });
    expect(next).toEqual({ scrollLeft: 0, scrollTop: 0 });
  });
});

describe("panScroll — 드래그 델타 → 스크롤 오프셋", () => {
  const origin = { scrollLeft: 100, scrollTop: 200, clientX: 50, clientY: 60 };

  it("오른쪽·아래로 끌면 스크롤이 줄어든다 (콘텐츠를 끌어오는 방향)", () => {
    const next = panScroll(origin, { clientX: 70, clientY: 90 });
    expect(next.scrollLeft).toBe(80); // 100 - 20
    expect(next.scrollTop).toBe(170); // 200 - 30
  });

  it("왼쪽·위로 끌면 스크롤이 늘어난다", () => {
    const next = panScroll(origin, { clientX: 30, clientY: 40 });
    expect(next.scrollLeft).toBe(120);
    expect(next.scrollTop).toBe(220);
  });

  it("움직이지 않으면 시작 오프셋 그대로다", () => {
    expect(panScroll(origin, { clientX: 50, clientY: 60 })).toEqual({
      scrollLeft: 100,
      scrollTop: 200,
    });
  });
});

describe("formatZoomPercent — 배율 라벨", () => {
  it("퍼센트로 반올림한다", () => {
    expect(formatZoomPercent(0.3425)).toBe("34%");
    expect(formatZoomPercent(0.155)).toBe("16%");
    expect(formatZoomPercent(1)).toBe("100%");
    expect(formatZoomPercent(4)).toBe("400%");
  });
});
