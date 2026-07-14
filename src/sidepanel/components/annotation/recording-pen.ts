import {
  ANNOTATION_THICKNESS,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_STROKE_SCALE,
  type ThicknessKey,
} from "./presets";

export type RecordingPenTool = "pen" | "rect" | "highlight";

// 녹화 오버레이 획 스타일. pen·rect는 프리셋 두께·불투명, highlight는 두께 배율×반투명(마커).
// 이미지 어노테이션(konva)과 동일 상수에서 파생 — 한 곳(presets)만 바꾸면 양쪽 일치.
export function overlayStrokeStyle(
  tool: RecordingPenTool,
  thickness: ThicknessKey,
): { strokeWidth: number; opacity: number } {
  const base = ANNOTATION_THICKNESS[thickness];
  return tool === "highlight"
    ? { strokeWidth: base * HIGHLIGHT_STROKE_SCALE, opacity: HIGHLIGHT_OPACITY }
    : { strokeWidth: base, opacity: 1 };
}
