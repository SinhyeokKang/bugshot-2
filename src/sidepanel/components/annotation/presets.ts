import type { TranslationKey } from "@/i18n/ko";

export type AnnotationTool =
  | "select"
  | "arrow"
  | "rect"
  | "ellipse"
  | "pen"
  | "text"
  | "highlight";

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

export const HIGHLIGHT_OPACITY = 0.4;

// 형광펜은 마커 느낌을 위해 일반 stroke 두께(2/4/8)에 배율을 곱해 굵게 칠한다.
export const HIGHLIGHT_STROKE_SCALE = 4;

export type TextSizeKey = "S" | "M" | "L";

export const TEXT_SIZES: Record<TextSizeKey, number> = { S: 16, M: 24, L: 40 };

export const TEXT_SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSizeKey[];

export const DEFAULT_TEXT_SIZE: TextSizeKey = "M";

export interface AnnotationToolMeta {
  key: AnnotationTool;
  labelKey: TranslationKey;
}

export const ANNOTATION_TOOLS: readonly AnnotationToolMeta[] = [
  { key: "select", labelKey: "annotation.select" },
  { key: "pen", labelKey: "annotation.pen" },
  { key: "arrow", labelKey: "annotation.arrow" },
  { key: "rect", labelKey: "annotation.rect" },
  { key: "ellipse", labelKey: "annotation.ellipse" },
  { key: "text", labelKey: "annotation.text" },
  { key: "highlight", labelKey: "annotation.highlight" },
];

export const THICKNESS_KEYS = Object.keys(ANNOTATION_THICKNESS) as ThicknessKey[];

// 두께가 의미 있는(strokeWidth 활성) 도형 — 툴바 두께 활성·스타일 행 노출 판정의 단일 출처.
const STROKE_TOOLS: ReadonlySet<AnnotationTool> = new Set<AnnotationTool>([
  "arrow",
  "rect",
  "ellipse",
  "pen",
  "highlight",
]);

export function isStrokeTool(tool: AnnotationTool): boolean {
  return STROKE_TOOLS.has(tool);
}
