import { describe, it, expect } from "vitest";
import { pointsToPath, dropExpired, smoothPoint, rectPoints, PEN_SMOOTHING_ALPHA } from "../annotation-draw";
import { PEN_SMOOTHING_ALPHA as KONVA_PEN_SMOOTHING_ALPHA } from "@/sidepanel/components/annotation/shapes";

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

  it("타임스탬프가 붙은 3-튜플도 x,y만 읽어 직렬화한다", () => {
    expect(pointsToPath([
      [0, 0, 1000],
      [10, 10, 1050],
    ])).toBe("M0 0 L10 10");
  });
});

describe("dropExpired", () => {
  // [x, y, t] 3-튜플. now-t > lifetime인 선두(먼저 그린) 점을 잘라 꼬리부터 사라지게 한다.
  const pt = (x: number, t: number): [number, number, number] => [x, 0, t];

  it("만료된 앞쪽 점들만 제거하고 나머지는 순서대로 남긴다", () => {
    const points = [pt(0, 0), pt(1, 100), pt(2, 500), pt(3, 900)];
    // now=1000, lifetime=600 → age>600인 t=0(1000),t=100(900) 제거, t=500(500)·t=900(100) 유지.
    expect(dropExpired(points, 1000, 600)).toEqual([pt(2, 500), pt(3, 900)]);
  });

  it("모두 만료면 빈 배열", () => {
    const points = [pt(0, 0), pt(1, 100)];
    expect(dropExpired(points, 5000, 600)).toEqual([]);
  });

  it("만료 점이 없으면 원본 참조를 그대로 반환한다(불필요한 복사 없음)", () => {
    const points = [pt(0, 900), pt(1, 950)];
    expect(dropExpired(points, 1000, 600)).toBe(points);
  });

  it("빈 배열은 빈 배열", () => {
    expect(dropExpired([], 1000, 600)).toEqual([]);
  });

  it("경계값(age === lifetime)은 아직 살아있다", () => {
    const points = [pt(0, 400), pt(1, 500)];
    // t=400은 age=600===lifetime → 유지.
    expect(dropExpired(points, 1000, 600)).toEqual(points);
  });
});

describe("smoothPoint", () => {
  // EMA: s = prev + alpha*(raw - prev). shapes.ts updateShapeDraft(pen/highlight)와 동일 공식.
  it("alpha=0.35로 prev→raw 사이를 보간한다", () => {
    // prev=[0,0], raw=[10,20], alpha=0.35 → [3.5, 7]
    expect(smoothPoint([0, 0], [10, 20], 0.35)).toEqual([3.5, 7]);
  });

  it("alpha=0 이면 prev를 그대로 유지한다(최대 보정)", () => {
    expect(smoothPoint([4, 5], [100, 200], 0)).toEqual([4, 5]);
  });

  it("alpha=1 이면 raw를 그대로 따라간다(보정 없음)", () => {
    expect(smoothPoint([4, 5], [100, 200], 1)).toEqual([100, 200]);
  });

  it("음수 좌표에서도 축별로 독립 보간한다", () => {
    // prev=[-10,10], raw=[10,-10], alpha=0.5 → [0,0]
    expect(smoothPoint([-10, 10], [10, -10], 0.5)).toEqual([0, 0]);
  });

  it("드리프트 가드: content 스무딩 계수가 konva shapes.ts와 동일하다", () => {
    expect(PEN_SMOOTHING_ALPHA).toBe(KONVA_PEN_SMOOTHING_ALPHA);
    expect(PEN_SMOOTHING_ALPHA).toBe(0.35);
  });
});

// 박스는 네 꼭짓점을 같은 시각으로 찍어 기존 path 렌더·만료 경로를 그대로 탄다
// (점별 트레일 페이드가 아니라 3초 뒤 통째로 사라진다 — 도형이라 그게 자연스럽다).
describe("rectPoints", () => {
  it("시작점→끝점 사각형을 닫힌 점열로 만든다", () => {
    const pts = rectPoints([10, 20], [40, 60], 100);
    expect(pts).toEqual([
      [10, 20, 100],
      [40, 20, 100],
      [40, 60, 100],
      [10, 60, 100],
      [10, 20, 100],
    ]);
  });

  it("역방향 드래그(오른쪽 아래 → 왼쪽 위)도 같은 사각형", () => {
    const pts = rectPoints([40, 60], [10, 20], 5);
    expect(pointsToPath(pts)).toBe(pointsToPath(rectPoints([10, 20], [40, 60], 5)));
  });

  it("모든 점의 타임스탬프가 같아 통째로 만료된다", () => {
    const pts = rectPoints([0, 0], [10, 10], 1000);
    expect(new Set(pts.map((p) => p[2])).size).toBe(1);
    expect(dropExpired([...pts], 1000 + 3001, 3000)).toEqual([]);
  });

  it("닫힌 경로라 pointsToPath가 사각형을 그린다", () => {
    expect(pointsToPath(rectPoints([0, 0], [10, 5], 0))).toBe(
      "M0 0 L10 0 L10 5 L0 5 L0 0",
    );
  });
});
