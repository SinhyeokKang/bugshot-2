// store가 쓰는 어노테이션 기본값만 leaf로 뗀 것. editor-store가 components/annotation/presets를
// value import하면 컴포넌트 그래프가 store 번들(=background 포함)로 딸려온다.
export type ThicknessKey = "S" | "M" | "L";

export const ANNOTATION_COLORS = [
  "#ef4444", // red
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
  "#000000", // black
] as const;

export const DEFAULT_COLOR: string = ANNOTATION_COLORS[0];

export const ANNOTATION_THICKNESS: Record<ThicknessKey, number> = {
  S: 2,
  M: 4,
  L: 8,
};

export const DEFAULT_THICKNESS: ThicknessKey = "M";
