// 열거형(키워드) CSS 속성의 값 목록 단일 출처.
// 폼 SelectProp 옵션과 CSS 코드 뷰 값 자동완성이 같은 출처를 쓰도록 — 두 곳이 갈리는 것 방지.
export const PROP_VALUES: Record<string, string[]> = {
  display: [
    "block",
    "inline",
    "inline-block",
    "flex",
    "inline-flex",
    "grid",
    "inline-grid",
    "table",
    "inline-table",
    "table-row",
    "table-cell",
    "table-caption",
    "none",
  ],
  "flex-direction": ["row", "column", "row-reverse", "column-reverse"],
  "flex-wrap": ["nowrap", "wrap", "wrap-reverse"],
  "justify-content": [
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ],
  "align-items": ["flex-start", "flex-end", "center", "stretch", "baseline"],
  position: ["static", "relative", "absolute", "fixed", "sticky"],
  overflow: ["visible", "hidden", "scroll", "auto", "clip"],
  "overflow-x": ["visible", "hidden", "scroll", "auto", "clip"],
  "overflow-y": ["visible", "hidden", "scroll", "auto", "clip"],
  "white-space": [
    "normal",
    "nowrap",
    "pre",
    "pre-wrap",
    "pre-line",
    "break-spaces",
  ],
  "text-overflow": ["clip", "ellipsis"],
  "mix-blend-mode": [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ],
  "table-layout": ["auto", "fixed"],
  "border-collapse": ["separate", "collapse"],
  "caption-side": ["top", "bottom"],
  "empty-cells": ["show", "hide"],
  "vertical-align": [
    "baseline",
    "top",
    "middle",
    "bottom",
    "sub",
    "super",
    "text-top",
    "text-bottom",
  ],
  // 코드 뷰 전용(폼은 AlignmentProp) — 값 자동완성 커버.
  "text-align": ["left", "right", "center", "justify", "start", "end"],
};

// 모든 속성에 유효한 CSS-wide 키워드.
export const CSS_WIDE_KEYWORDS = ["initial", "inherit", "unset", "revert"];

// 폼 SelectProp 옵션: 빈 값(미설정) + 속성 고유 값.
export function selectOptions(prop: string): string[] {
  return ["", ...(PROP_VALUES[prop] ?? [])];
}

// CSS 코드 뷰 값 자동완성: 속성 고유 값 + CSS-wide. 열거형이 아니면 null(호출부 generic 폴백).
export function valueHintsFor(prop: string): string[] | null {
  const values = PROP_VALUES[prop];
  if (!values) return null;
  return [...values, ...CSS_WIDE_KEYWORDS];
}
