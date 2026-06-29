import { type AnnotationTool } from "./presets";

export interface ShapeBase {
  id: string;
  color: string;
  strokeWidth: number;
}

export interface ArrowShape extends ShapeBase {
  type: "arrow";
  points: number[];
}
export interface RectShape extends ShapeBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}
export interface EllipseShape extends ShapeBase {
  type: "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}
export interface PenShape extends ShapeBase {
  type: "pen";
  points: number[];
}
export interface HighlightShape extends ShapeBase {
  type: "highlight";
  points: number[];
}
export interface TextShape extends ShapeBase {
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
}

export type AnnotationShape =
  | ArrowShape
  | RectShape
  | EllipseShape
  | PenShape
  | HighlightShape
  | TextShape;

export interface ShapeStyle {
  color: string;
  strokeWidth: number;
  fontSize: number;
}

type Point = { x: number; y: number };

export function createShape(
  tool: Exclude<AnnotationTool, "select">,
  id: string,
  pt: Point,
  style: ShapeStyle,
): AnnotationShape {
  const base = { id, color: style.color, strokeWidth: style.strokeWidth };
  switch (tool) {
    case "arrow":
      return { ...base, type: "arrow", points: [pt.x, pt.y, pt.x, pt.y] };
    case "rect":
      return { ...base, type: "rect", x: pt.x, y: pt.y, width: 0, height: 0, rotation: 0 };
    case "ellipse":
      return { ...base, type: "ellipse", x: pt.x, y: pt.y, width: 0, height: 0, rotation: 0 };
    case "pen":
      return { ...base, type: "pen", points: [pt.x, pt.y] };
    case "highlight":
      return { ...base, type: "highlight", points: [pt.x, pt.y] };
    case "text":
      return { ...base, type: "text", x: pt.x, y: pt.y, width: 0, height: 0, text: "", fontSize: style.fontSize };
  }
}

export function updateShapeDraft(shape: AnnotationShape, pt: Point): AnnotationShape {
  switch (shape.type) {
    case "rect":
    case "ellipse":
    case "text":
      return { ...shape, width: pt.x - shape.x, height: pt.y - shape.y };
    case "arrow":
      return { ...shape, points: [shape.points[0], shape.points[1], pt.x, pt.y] };
    case "pen":
    case "highlight":
      return { ...shape, points: [...shape.points, pt.x, pt.y] };
  }
}

export function isEmptyShape(shape: AnnotationShape): boolean {
  switch (shape.type) {
    case "rect":
    case "ellipse":
      return shape.width === 0 || shape.height === 0;
    case "arrow":
      return (
        shape.points[0] === shape.points[2] && shape.points[1] === shape.points[3]
      );
    case "pen":
    case "highlight":
      return shape.points.length <= 2;
    case "text":
      return shape.text.trim() === "";
  }
}

interface TransformAttrs {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

// Transformer transform end의 scale/rotation을 도형 자체 좌표로 흡수해 정규화한다
// (노드 scale을 1로 리셋하는 전제). rect/ellipse는 width/height·rotation에,
// points 기반 도형은 각 점에 (scale→rotate→translate) 행렬을 베이크한다.
export function applyTransform(
  shape: AnnotationShape,
  attrs: TransformAttrs,
): AnnotationShape {
  switch (shape.type) {
    case "rect":
    case "ellipse":
      return {
        ...shape,
        x: attrs.x,
        y: attrs.y,
        width: shape.width * attrs.scaleX,
        height: shape.height * attrs.scaleY,
        rotation: attrs.rotation,
      };
    case "text":
      // 박스 리사이즈는 wrap 폭만 바꾼다 — fontSize는 크기 버튼으로만 제어(컨테이너 개념).
      return {
        ...shape,
        x: attrs.x,
        y: attrs.y,
        width: shape.width * attrs.scaleX,
        height: shape.height * attrs.scaleY,
      };
    case "arrow":
    case "pen":
    case "highlight":
      return { ...shape, points: transformPoints(shape.points, attrs) };
  }
}

function transformPoints(points: number[], attrs: TransformAttrs): number[] {
  const rad = (attrs.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const sx = points[i] * attrs.scaleX;
    const sy = points[i + 1] * attrs.scaleY;
    out.push(sx * cos - sy * sin + attrs.x, sx * sin + sy * cos + attrs.y);
  }
  return out;
}
