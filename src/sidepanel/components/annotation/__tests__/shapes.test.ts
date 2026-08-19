import { describe, expect, it } from "vitest";
import {
  applyTransform,
  createShape,
  ellipseRenderGeometry,
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

// ─────────────────────────────────────────────────────────────────────────────
// ellipseRenderGeometry — Konva Ellipse는 로컬 원점에 중심을 그리고, 노드 변환은
// translate(x,y) 후 translate(-offsetX,-offsetY)다. 따라서 **절대 중심 = position - offset**.
// bounding box의 중심은 `x + width/2`이고 이 값은 width의 **부호를 보존**해야 한다 —
// `Math.abs(width)/2`로 offset을 만들면 좌/상 방향 드래그에서 중심이 앵커 반대편에 놓여
// 원이 거울 반사된다(rect는 Konva가 음수 width를 native로 처리해 무증상이라 ellipse만 터진다).
//
// ShapeNode는 react-konva 컴포넌트라 캔버스 실동작에 걸려 jsdom으로 못 잡는다. 그래서 기하만
// 순수 함수로 떼어 여기서 고정하고, 컴포넌트는 결과를 props로 펴는 얇은 껍데기로 둔다.
// ─────────────────────────────────────────────────────────────────────────────
describe("ellipseRenderGeometry — 부호 있는 offset이 중심을 결정한다", () => {
  // Konva 의미론을 그대로 재현한다. offset 값을 하드코딩해 비교하면 "구현이 무엇을 넣었나"만
  // 확인하게 되고 의미가 고정되지 않는다.
  const centerOf = (g: { x: number; y: number; offsetX: number; offsetY: number }) => ({
    x: g.x - g.offsetX,
    y: g.y - g.offsetY,
  });

  // 실제 유입 경로를 재현한다 — 드래그는 createShape(앵커) → updateShapeDraft(끝점)다.
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }): EllipseShape =>
    updateShapeDraft(createShape("ellipse", "e", from, style), to) as EllipseShape;

  it("우하단 드래그 — 중심이 앵커와 끝점의 중간이다", () => {
    const g = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 140, y: 140 }));

    expect(centerOf(g)).toEqual({ x: 120, y: 120 });
  });

  // 이게 사용자가 본 증상이다 — 앵커(100,100)에서 좌상단(60,60)으로 끌면 중심은 (80,80)이어야
  // 하는데, abs offset은 (120,120)을 만들어 원이 앵커 반대편에 그려졌다.
  it("좌상단 드래그 — 중심이 앵커의 왼쪽·위에 온다(거울 반사 없음)", () => {
    const g = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 60, y: 60 }));

    expect(centerOf(g)).toEqual({ x: 80, y: 80 });
  });

  it("부호가 섞인 드래그(좌하단·우상단)도 각 축을 독립으로 따른다", () => {
    const leftDown = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 60, y: 140 }));
    const rightUp = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 140, y: 60 }));

    expect(centerOf(leftDown)).toEqual({ x: 80, y: 120 });
    expect(centerOf(rightUp)).toEqual({ x: 120, y: 80 });
  });

  // 음수 width의 두 번째 유입 경로 — Transformer의 flip을 applyTransform이 흡수한다.
  it("flip 리사이즈로 음수가 흡수된 뒤에도 중심이 정합이다", () => {
    const base: EllipseShape = {
      id: "e",
      type: "ellipse",
      x: 10,
      y: 20,
      width: 40,
      height: 20,
      color: "#000000",
      strokeWidth: 2,
    };
    const flipped = applyTransform(base, {
      x: 10,
      y: 20,
      scaleX: -1,
      scaleY: -1,
      rotation: 0,
    }) as EllipseShape;
    const g = ellipseRenderGeometry(flipped);

    expect(flipped.width).toBeCloseTo(-40);
    expect(centerOf(g).x).toBeCloseTo(10 + -40 / 2);
    expect(centerOf(g).y).toBeCloseTo(20 + -20 / 2);
  });

  it("radius는 어느 부호에서도 음수가 아니다", () => {
    const g = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 60, y: 60 }));

    expect(g.radiusX).toBe(20);
    expect(g.radiusY).toBe(20);
  });

  it("한 축이 0인 드래그(수평·수직)도 그 축의 반지름이 0이다", () => {
    const vertical = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 100, y: 60 }));

    expect(vertical.radiusX).toBe(0);
    expect(vertical.radiusY).toBe(20);
    expect(centerOf(vertical)).toEqual({ x: 100, y: 80 });
  });

  // 비공허 실증 — abs로 offset을 만들면 두 방향이 같은 중심을 내므로 여기서 red가 난다.
  it("같은 크기라도 방향이 반대면 중심도 반대다", () => {
    const rightDown = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 140, y: 140 }));
    const leftUp = ellipseRenderGeometry(drag({ x: 100, y: 100 }, { x: 60, y: 60 }));

    expect(centerOf(leftUp)).not.toEqual(centerOf(rightDown));
  });
});
