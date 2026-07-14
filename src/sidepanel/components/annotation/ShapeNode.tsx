import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Arrow, Ellipse, Line, Rect, Text } from "react-konva";
import { HIGHLIGHT_OPACITY, HIGHLIGHT_STROKE_SCALE } from "./presets";
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
  // 도형을 벗어날 때 복구할 커서. 오버레이가 도구·팬 상태로 결정하므로 여기서 "default"를
  // 하드코딩하면 팬의 grab 커서를 덮어쓴다.
  restCursor?: string;
  // 팬 드래그 진행 중 — hover 커서 갱신을 막아 grabbing이 유지되게 한다.
  cursorLocked?: boolean;
}

function isPointsShape(type: AnnotationShape["type"]): boolean {
  return type === "arrow" || type === "pen" || type === "highlight";
}

// stroke만 있는 도형은 hit 영역이 stroke 폭뿐이라 정확히 눌러야 선택된다 →
// hit 영역을 넓혀 경계 근처 클릭으로도 잡히게 한다(렌더엔 영향 없음).
const SELECT_HIT_WIDTH = 24;

export function ShapeNode({
  shape,
  selectable,
  onSelect,
  onCommit,
  registerRef,
  restCursor = "default",
  cursorLocked = false,
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
    if (!selectable || cursorLocked) return;
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
    onMouseLeave: (e: KonvaEventObject<MouseEvent>) => hoverCursor(e, restCursor),
  };

  switch (shape.type) {
    case "arrow": {
      const head = Math.max(14, shape.strokeWidth * 4);
      return (
        <Arrow
          {...common}
          points={shape.points}
          stroke={shape.color}
          fill={shape.color}
          strokeWidth={shape.strokeWidth}
          pointerLength={head}
          pointerWidth={head}
          hitStrokeWidth={Math.max(SELECT_HIT_WIDTH, shape.strokeWidth)}
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
          fill="transparent"
          hitStrokeWidth={SELECT_HIT_WIDTH}
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
          fill="transparent"
          hitStrokeWidth={SELECT_HIT_WIDTH}
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
          hitStrokeWidth={Math.max(SELECT_HIT_WIDTH, shape.strokeWidth)}
        />
      );
    case "highlight": {
      // 두께(2/4/8)에 배율을 곱해 마커처럼 굵게. transform은 폭을 안 건드림(두께 버튼으로만 제어).
      const hlWidth = shape.strokeWidth * HIGHLIGHT_STROKE_SCALE;
      return (
        <Line
          {...common}
          points={shape.points}
          stroke={shape.color}
          strokeWidth={hlWidth}
          opacity={HIGHLIGHT_OPACITY}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(SELECT_HIT_WIDTH, hlWidth)}
        />
      );
    }
    case "text":
      return (
        <Text
          {...common}
          x={shape.x}
          y={shape.y}
          width={shape.width > 0 ? shape.width : undefined}
          text={shape.text}
          fontSize={shape.fontSize}
          lineHeight={1.2}
          fill={shape.color}
        />
      );
  }
}
