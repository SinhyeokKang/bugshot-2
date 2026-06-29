import { describe, expect, it } from "vitest";
import {
  applyTransform,
  createShape,
  fitScale,
  isEmptyShape,
  PEN_SMOOTHING_ALPHA,
  updateShapeDraft,
  type EllipseShape,
  type RectShape,
  type ShapeStyle,
} from "../shapes";

const style: ShapeStyle = { color: "#ff0000", strokeWidth: 4, fontSize: 24 };

// EMA: 새 점은 직전(이미 보정된) 점에서 raw 쪽으로 α만큼만 이동한다.
const sm = (prev: number, raw: number) => prev + PEN_SMOOTHING_ALPHA * (raw - prev);

describe("createShape — 초기 도형 생성", () => {
  it("rect는 시작점에서 width/height 0으로 생성된다", () => {
    const s = createShape("rect", "id1", { x: 10, y: 20 }, style) as RectShape;
    expect(s.type).toBe("rect");
    expect(s.x).toBe(10);
    expect(s.y).toBe(20);
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
  });

  it("좌표·스타일·id가 반영된다", () => {
    const s = createShape("rect", "id1", { x: 10, y: 20 }, style) as RectShape;
    expect(s.id).toBe("id1");
    expect(s.color).toBe("#ff0000");
    expect(s.strokeWidth).toBe(4);
  });

  it("ellipse도 시작점에서 면적 0으로 생성된다", () => {
    const s = createShape("ellipse", "id2", { x: 5, y: 5 }, style) as EllipseShape;
    expect(s.type).toBe("ellipse");
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
  });

  it("arrow는 시작점=끝점 points로 생성된다", () => {
    const s = createShape("arrow", "id3", { x: 3, y: 7 }, style);
    expect(s.type).toBe("arrow");
    if (s.type === "arrow") {
      expect(s.points).toEqual([3, 7, 3, 7]);
    }
  });

  it("pen은 시작점 1개 points로 생성된다", () => {
    const s = createShape("pen", "id4", { x: 1, y: 2 }, style);
    expect(s.type).toBe("pen");
    if (s.type === "pen") {
      expect(s.points).toEqual([1, 2]);
    }
  });

  it("text는 빈 문자열·박스 0·style.fontSize로 생성된다", () => {
    const s = createShape("text", "id5", { x: 8, y: 9 }, style);
    expect(s.type).toBe("text");
    if (s.type === "text") {
      expect(s.text).toBe("");
      expect(s.x).toBe(8);
      expect(s.y).toBe(9);
      expect(s.width).toBe(0);
      expect(s.height).toBe(0);
      expect(s.fontSize).toBe(24);
    }
  });
});

describe("updateShapeDraft — 드래그 중 갱신", () => {
  it("rect는 끝점까지의 width/height를 가진다", () => {
    const s = createShape("rect", "id", { x: 10, y: 10 }, style);
    const next = updateShapeDraft(s, { x: 40, y: 30 }) as RectShape;
    expect(next.width).toBe(30);
    expect(next.height).toBe(20);
  });

  it("ellipse도 width/height가 갱신된다", () => {
    const s = createShape("ellipse", "id", { x: 0, y: 0 }, style);
    const next = updateShapeDraft(s, { x: 50, y: 25 }) as EllipseShape;
    expect(next.width).toBe(50);
    expect(next.height).toBe(25);
  });

  it("arrow는 끝점이 갱신된다", () => {
    const s = createShape("arrow", "id", { x: 0, y: 0 }, style);
    const next = updateShapeDraft(s, { x: 100, y: 50 });
    if (next.type === "arrow") {
      expect(next.points).toEqual([0, 0, 100, 50]);
    }
  });

  it("pen은 EMA 보정된 points가 누적된다", () => {
    let s = createShape("pen", "id", { x: 0, y: 0 }, style);
    s = updateShapeDraft(s, { x: 1, y: 1 });
    s = updateShapeDraft(s, { x: 2, y: 2 });
    if (s.type === "pen") {
      const p1 = sm(0, 1);
      const p2 = sm(p1, 2);
      expect(s.points).toEqual([0, 0, p1, p1, p2, p2]);
    }
  });

  it("highlight도 EMA 보정된 points가 누적된다", () => {
    let s = createShape("highlight", "id", { x: 0, y: 0 }, style);
    s = updateShapeDraft(s, { x: 3, y: 4 });
    if (s.type === "highlight") {
      expect(s.points).toEqual([0, 0, sm(0, 3), sm(0, 4)]);
    }
  });

  it("pen 보정점은 시작점과 raw 사이에 놓인다(커서를 그대로 찍지 않음)", () => {
    let s = createShape("pen", "id", { x: 0, y: 0 }, style);
    s = updateShapeDraft(s, { x: 100, y: 0 });
    if (s.type === "pen") {
      const x = s.points[2];
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(100);
    }
  });

  it("같은 좌표를 반복 입력하면 보정점이 그 좌표로 수렴한다", () => {
    let s = createShape("pen", "id", { x: 0, y: 0 }, style);
    for (let i = 0; i < 40; i++) s = updateShapeDraft(s, { x: 10, y: 10 });
    if (s.type === "pen") {
      const n = s.points.length;
      expect(s.points[n - 2]).toBeCloseTo(10, 1);
      expect(s.points[n - 1]).toBeCloseTo(10, 1);
    }
  });

  it("입력 도형을 변형하지 않는다(불변)", () => {
    const s = createShape("rect", "id", { x: 0, y: 0 }, style) as RectShape;
    const next = updateShapeDraft(s, { x: 10, y: 10 });
    expect(next).not.toBe(s);
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
  });

  it("text는 드래그로 박스 width/height를 가진다", () => {
    const s = createShape("text", "id", { x: 5, y: 5 }, style);
    const next = updateShapeDraft(s, { x: 45, y: 35 });
    expect(next).not.toBe(s);
    if (next.type === "text") {
      expect(next.width).toBe(40);
      expect(next.height).toBe(30);
    }
  });
});

describe("fitScale — 표시 배율", () => {
  it("폭 제약이 더 빡세면 폭 기준 축소", () => {
    expect(fitScale(1000, 500, 400, 1000)).toBeCloseTo(0.4);
  });

  it("높이 제약이 더 빡세면 높이 기준 축소", () => {
    expect(fitScale(500, 1000, 1000, 400)).toBeCloseTo(0.4);
  });

  it("작은 이미지는 확대하지 않는다(최대 1)", () => {
    expect(fitScale(100, 100, 400, 400)).toBe(1);
  });

  it("0 이하 크기는 1을 반환한다", () => {
    expect(fitScale(0, 100, 400, 400)).toBe(1);
    expect(fitScale(100, 0, 400, 400)).toBe(1);
  });
});

describe("isEmptyShape — 빈 도형 판정", () => {
  it("면적 0 rect는 비어있다", () => {
    const s = createShape("rect", "id", { x: 10, y: 10 }, style);
    expect(isEmptyShape(s)).toBe(true);
  });

  it("면적 0 ellipse는 비어있다", () => {
    const s = createShape("ellipse", "id", { x: 10, y: 10 }, style);
    expect(isEmptyShape(s)).toBe(true);
  });

  it("height만 0인 rect(수평 드래그)도 비어있다", () => {
    const s = updateShapeDraft(
      createShape("rect", "id", { x: 0, y: 0 }, style),
      { x: 30, y: 0 },
    ) as RectShape;
    expect(s.width).toBe(30);
    expect(s.height).toBe(0);
    expect(isEmptyShape(s)).toBe(true);
  });

  it("width만 0인 ellipse(수직 드래그)도 비어있다", () => {
    const s = updateShapeDraft(
      createShape("ellipse", "id", { x: 0, y: 0 }, style),
      { x: 0, y: 30 },
    ) as EllipseShape;
    expect(s.width).toBe(0);
    expect(isEmptyShape(s)).toBe(true);
  });

  it("빈 텍스트는 비어있다", () => {
    const s = createShape("text", "id", { x: 0, y: 0 }, style);
    expect(isEmptyShape(s)).toBe(true);
  });

  it("점 1개뿐인 pen은 비어있다", () => {
    const s = createShape("pen", "id", { x: 0, y: 0 }, style);
    expect(isEmptyShape(s)).toBe(true);
  });

  it("크기가 있는 rect는 비어있지 않다", () => {
    const s = updateShapeDraft(
      createShape("rect", "id", { x: 0, y: 0 }, style),
      { x: 20, y: 20 },
    );
    expect(isEmptyShape(s)).toBe(false);
  });

  it("내용 있는 텍스트는 비어있지 않다", () => {
    const s = createShape("text", "id", { x: 0, y: 0 }, style);
    if (s.type === "text") s.text = "버그";
    expect(isEmptyShape(s)).toBe(false);
  });

  it("점 2개 이상 pen은 비어있지 않다", () => {
    const s = updateShapeDraft(
      createShape("pen", "id", { x: 0, y: 0 }, style),
      { x: 5, y: 5 },
    );
    expect(isEmptyShape(s)).toBe(false);
  });
});

describe("applyTransform — scale/rotation 흡수 정규화", () => {
  const baseRect = (): RectShape => ({
    id: "id",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    color: "#000000",
    strokeWidth: 2,
  });

  it("scaleX/scaleY를 width/height로 흡수한다", () => {
    const next = applyTransform(baseRect(), {
      x: 0,
      y: 0,
      scaleX: 2,
      scaleY: 3,
      rotation: 0,
    }) as RectShape;
    expect(next.width).toBeCloseTo(200);
    expect(next.height).toBeCloseTo(150);
  });

  it("rotation을 반영한다", () => {
    const next = applyTransform(baseRect(), {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 45,
    }) as RectShape;
    expect(next.rotation).toBeCloseTo(45);
  });

  it("위치(x/y)를 반영한다", () => {
    const next = applyTransform(baseRect(), {
      x: 30,
      y: 40,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    }) as RectShape;
    expect(next.x).toBeCloseTo(30);
    expect(next.y).toBeCloseTo(40);
  });

  it("scale 1 반복 적용 시 누적 왜곡이 없다", () => {
    let s = baseRect();
    for (let i = 0; i < 5; i++) {
      s = applyTransform(s, {
        x: s.x,
        y: s.y,
        scaleX: 1,
        scaleY: 1,
        rotation: s.rotation ?? 0,
      }) as RectShape;
    }
    expect(s.width).toBeCloseTo(100);
    expect(s.height).toBeCloseTo(50);
  });

  it("입력 도형을 변형하지 않는다(불변)", () => {
    const s = baseRect();
    const next = applyTransform(s, {
      x: 0,
      y: 0,
      scaleX: 2,
      scaleY: 2,
      rotation: 0,
    });
    expect(next).not.toBe(s);
    expect(s.width).toBe(100);
    expect(s.height).toBe(50);
  });

  it("음수 scaleX(flip)도 width에 그대로 흡수한다", () => {
    const next = applyTransform(baseRect(), {
      x: 0,
      y: 0,
      scaleX: -1,
      scaleY: 1,
      rotation: 0,
    }) as RectShape;
    expect(next.width).toBeCloseTo(-100);
    expect(next.height).toBeCloseTo(50);
  });

  it("ellipse 음수 scaleY(flip)도 height에 흡수한다(렌더는 abs로 복구)", () => {
    const base: EllipseShape = {
      id: "id",
      type: "ellipse",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      color: "#000000",
      strokeWidth: 2,
    };
    const next = applyTransform(base, {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: -1,
      rotation: 0,
    }) as EllipseShape;
    expect(next.height).toBeCloseTo(-20);
    expect(next.width).toBeCloseTo(40);
  });

  it("points 도형은 scale→rotate→translate 행렬을 좌표에 베이크한다", () => {
    // arrow points [0,0, 10,0] → scaleX2(=[0,0, 20,0]) → rot90(=[0,0, 0,20]) → +T(5,5)
    let s = updateShapeDraft(
      createShape("arrow", "id", { x: 0, y: 0 }, style),
      { x: 10, y: 0 },
    );
    s = applyTransform(s, { x: 5, y: 5, scaleX: 2, scaleY: 1, rotation: 90 });
    if (s.type === "arrow") {
      expect(s.points[0]).toBeCloseTo(5);
      expect(s.points[1]).toBeCloseTo(5);
      expect(s.points[2]).toBeCloseTo(5);
      expect(s.points[3]).toBeCloseTo(25);
    }
  });

  it("text 박스는 scale로 width/height만 변하고 fontSize는 고정된다", () => {
    const base = createShape("text", "id", { x: 0, y: 0 }, style);
    let s = updateShapeDraft(base, { x: 100, y: 40 });
    s = applyTransform(s, { x: 0, y: 0, scaleX: 2, scaleY: 1.5, rotation: 0 });
    if (s.type === "text") {
      expect(s.width).toBeCloseTo(200);
      expect(s.height).toBeCloseTo(60);
      expect(s.fontSize).toBe(24);
    }
  });

  it("points 도형도 입력을 변형하지 않는다(불변)", () => {
    const s = updateShapeDraft(
      createShape("pen", "id", { x: 1, y: 2 }, style),
      { x: 3, y: 4 },
    );
    const before = [...(s as { points: number[] }).points];
    const next = applyTransform(s, { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0 });
    expect(next).not.toBe(s);
    expect((s as { points: number[] }).points).toEqual(before);
  });
});
