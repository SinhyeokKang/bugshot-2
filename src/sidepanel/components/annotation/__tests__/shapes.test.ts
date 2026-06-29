import { describe, expect, it } from "vitest";
import {
  applyTransform,
  createShape,
  isEmptyShape,
  updateShapeDraft,
  type EllipseShape,
  type RectShape,
  type ShapeStyle,
} from "../shapes";

const style: ShapeStyle = { color: "#ff0000", strokeWidth: 4 };

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

  it("text는 빈 문자열로 생성된다", () => {
    const s = createShape("text", "id5", { x: 8, y: 9 }, style);
    expect(s.type).toBe("text");
    if (s.type === "text") {
      expect(s.text).toBe("");
      expect(s.x).toBe(8);
      expect(s.y).toBe(9);
      expect(s.fontSize).toBeGreaterThan(0);
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

  it("pen은 points가 누적된다", () => {
    let s = createShape("pen", "id", { x: 0, y: 0 }, style);
    s = updateShapeDraft(s, { x: 1, y: 1 });
    s = updateShapeDraft(s, { x: 2, y: 2 });
    if (s.type === "pen") {
      expect(s.points).toEqual([0, 0, 1, 1, 2, 2]);
    }
  });

  it("highlight도 points가 누적된다", () => {
    let s = createShape("highlight", "id", { x: 0, y: 0 }, style);
    s = updateShapeDraft(s, { x: 3, y: 4 });
    if (s.type === "highlight") {
      expect(s.points).toEqual([0, 0, 3, 4]);
    }
  });

  it("입력 도형을 변형하지 않는다(불변)", () => {
    const s = createShape("rect", "id", { x: 0, y: 0 }, style) as RectShape;
    const next = updateShapeDraft(s, { x: 10, y: 10 });
    expect(next).not.toBe(s);
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
  });

  it("text는 갱신 대상이 아니어도 새 객체를 반환한다(불변)", () => {
    const s = createShape("text", "id", { x: 0, y: 0 }, style);
    const next = updateShapeDraft(s, { x: 10, y: 10 });
    expect(next).not.toBe(s);
    expect(next).toEqual(s);
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
