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

// 형광펜은 두께 선택 대상이 아니라(툴바에서 disabled) 고정 폭으로 굵게 칠한다.
export const HIGHLIGHT_STROKE_WIDTH = 18;

export const TEXT_FONT_SIZE = 24;

export interface AnnotationToolMeta {
  key: AnnotationTool;
  labelKey: TranslationKey;
}

export const ANNOTATION_TOOLS: readonly AnnotationToolMeta[] = [
  { key: "select", labelKey: "annotation.select" },
  { key: "arrow", labelKey: "annotation.arrow" },
  { key: "rect", labelKey: "annotation.rect" },
  { key: "ellipse", labelKey: "annotation.ellipse" },
  { key: "pen", labelKey: "annotation.pen" },
  { key: "text", labelKey: "annotation.text" },
  { key: "highlight", labelKey: "annotation.highlight" },
];
