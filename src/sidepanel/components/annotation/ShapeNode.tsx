import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Arrow, Ellipse, Line, Rect, Text } from "react-konva";
import { HIGHLIGHT_OPACITY, HIGHLIGHT_STROKE_WIDTH } from "./presets";
import type { AnnotationShape } from "./shapes";

export interface TransformAttrs {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

interface ShapeNodeProps {
  shape: AnnotationShape;
  // select 도구일 때만 드래그/선택/transform 활성
  selectable: boolean;
  onSelect: () => void;
  onCommit: (attrs: TransformAttrs) => void;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

function isPointsShape(type: AnnotationShape["type"]): boolean {
  return type === "arrow" || type === "pen" || type === "highlight";
}

export function ShapeNode({
  shape,
  selectable,
  onSelect,
  onCommit,
  registerRef,
}: ShapeNodeProps) {
  const ref = (node: Konva.Node | null) => registerRef(shape.id, node);

  const readAttrs = (node: Konva.Node): TransformAttrs => ({
    x: node.x(),
    y: node.y(),
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
    rotation: node.rotation(),
  });

  // drag/transform 종료 후 노드의 imperative 변환을 흡수 좌표로 commit하고,
  // points 도형은 좌표에 베이크되므로 노드 자체 offset/scale/rotation을 0/1로 리셋한다.
  const commitFrom = (node: Konva.Node) => {
    const attrs = readAttrs(node);
    node.scaleX(1);
    node.scaleY(1);
    if (isPointsShape(shape.type)) {
      node.x(0);
      node.y(0);
      node.rotation(0);
    }
    onCommit(attrs);
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => commitFrom(e.target);
  const handleTransformEnd = (e: KonvaEventObject<Event>) => commitFrom(e.target);

  const hoverCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
    if (!selectable) return;
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = cursor;
  };

  const common = {
    ref,
    draggable: selectable,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: handleDragEnd,
    onTransformEnd: handleTransformEnd,
    onMouseEnter: (e: KonvaEventObject<MouseEvent>) => hoverCursor(e, "move"),
    onMouseLeave: (e: KonvaEventObject<MouseEvent>) => hoverCursor(e, "default"),
  };

  switch (shape.type) {
    case "arrow": {
      const head = Math.max(10, shape.strokeWidth * 2.5);
      return (
        <Arrow
          {...common}
          points={shape.points}
          stroke={shape.color}
          fill={shape.color}
          strokeWidth={shape.strokeWidth}
          pointerLength={head}
          pointerWidth={head}
          hitStrokeWidth={Math.max(12, shape.strokeWidth)}
        />
      );
    }
    case "rect":
      return (
        <Rect
          {...common}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rotation={shape.rotation ?? 0}
          stroke={shape.color}
          strokeWidth={shape.strokeWidth}
        />
      );
    case "ellipse": {
      // offset으로 bounding-box top-left를 노드 위치에 맞춰 rect와 동일 좌표계로 통일
      // (applyTransform이 shape.x/y를 top-left로 흡수 — 중심 기준이면 transform마다 어긋남).
      const rx = Math.abs(shape.width) / 2;
      const ry = Math.abs(shape.height) / 2;
      return (
        <Ellipse
          {...common}
          x={shape.x}
          y={shape.y}
          offsetX={-rx}
          offsetY={-ry}
          radiusX={rx}
          radiusY={ry}
          rotation={shape.rotation ?? 0}
          stroke={shape.color}
          strokeWidth={shape.strokeWidth}
        />
      );
    }
    case "pen":
      return (
        <Line
          {...common}
          points={shape.points}
          stroke={shape.color}
          strokeWidth={shape.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
        />
      );
    case "highlight":
      // 폭은 상수 고정 — transform으로 확대해도 폭은 안 따라가는 게 의도(균일한 마커 느낌 유지).
      return (
        <Line
          {...common}
          points={shape.points}
          stroke={shape.color}
          strokeWidth={HIGHLIGHT_STROKE_WIDTH}
          opacity={HIGHLIGHT_OPACITY}
          lineCap="round"
          lineJoin="round"
        />
      );
    case "text":
      return (
        <Text
          {...common}
          x={shape.x}
          y={shape.y}
          text={shape.text}
          fontSize={shape.fontSize}
          fill={shape.color}
        />
      );
  }
}
