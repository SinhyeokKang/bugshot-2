import { describe, it, expect } from "vitest";

import {
  CONTEXT_MAX_VIEWPORT_RATIO,
  passesContextGates,
} from "../capture-context";

// 1000×800 = 800,000px². 40% 상한 = 320,000px².
const VIEWPORT = { width: 1000, height: 800 };

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

describe("passesContextGates", () => {
  it("상한 상수는 뷰포트 면적의 40%다", () => {
    expect(CONTEXT_MAX_VIEWPORT_RATIO).toBe(0.4);
  });

  it("뷰포트 안 + 요소 완전 포함 + 면적 30%면 통과", () => {
    // 600×400 = 240,000 = 30%
    expect(
      passesContextGates(rect(10, 10, 100, 50), rect(0, 0, 600, 400), VIEWPORT),
    ).toBe(true);
  });

  it("면적 50%면 상한 초과로 거부", () => {
    // 800×500 = 400,000 = 50%
    expect(
      passesContextGates(rect(10, 10, 100, 50), rect(0, 0, 800, 500), VIEWPORT),
    ).toBe(false);
  });

  it("면적이 정확히 40%면 경계 포함으로 통과", () => {
    // 800×400 = 320,000 = 40%
    expect(
      passesContextGates(rect(10, 10, 100, 50), rect(0, 0, 800, 400), VIEWPORT),
    ).toBe(true);
  });

  it("요소가 컨테이너 밖으로 삐져나가면 거부 (G2)", () => {
    // 요소 right=700 > 컨테이너 right=600
    expect(
      passesContextGates(rect(500, 300, 200, 200), rect(0, 0, 600, 400), VIEWPORT),
    ).toBe(false);
  });

  it("요소 rect가 0×0이면 G2를 생략하고 통과 (display:none)", () => {
    // 기하 포함 검사가 무의미하므로 건너뛴다 — DOM 포함 검증은 호출부가 맡는다.
    // 컨테이너를 원점에서 떼어놔야 이 단언이 실효를 갖는다: 원점 컨테이너는
    // containsRect((0,0,…),(0,0,0,0))가 그냥 true라 G2 생략 여부와 무관하게 통과한다.
    expect(
      passesContextGates(rect(0, 0, 0, 0), rect(100, 100, 600, 400), VIEWPORT),
    ).toBe(true);
  });

  it("컨테이너 상단이 뷰포트 위로 벗어나면 거부 — 클램프하지 않는다 (G1)", () => {
    expect(
      passesContextGates(rect(10, 10, 100, 50), rect(0, -10, 600, 400), VIEWPORT),
    ).toBe(false);
  });

  it("컨테이너 하단이 뷰포트 아래로 벗어나면 거부 (G1)", () => {
    // bottom = 600 + 400 = 1000 > 800
    expect(
      passesContextGates(rect(10, 610, 100, 50), rect(0, 600, 600, 400), VIEWPORT),
    ).toBe(false);
  });

  it("뷰포트보다 큰 컨테이너는 거부한다 — 클램프해서 재판정하지 않는다", () => {
    // 1200×300을 뷰포트로 자르면 1000×300 = 300,000 (37.5%)라 클램프 방식이었으면
    // 통과했을 크기다. 자르지 않으므로 G1에서 떨어지고, 면적도 360,000이라 어차피 초과.
    expect(
      passesContextGates(rect(10, 10, 100, 50), rect(-100, 0, 1200, 300), VIEWPORT),
    ).toBe(false);
  });

  it("viewport.width가 0이면 거부 (면적 0 방어)", () => {
    expect(
      passesContextGates(rect(0, 0, 10, 10), rect(0, 0, 10, 10), {
        width: 0,
        height: 800,
      }),
    ).toBe(false);
  });
});
