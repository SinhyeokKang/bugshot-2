import type { TokenCategory } from "@/types/picker";

export const PROP_CATEGORY: Record<string, TokenCategory> = {
  color: "color",
  "background-color": "color",
  "background-image": "image",
  "border-top-width": "length",
  "border-right-width": "length",
  "border-bottom-width": "length",
  "border-left-width": "length",
  "border-top-color": "color",
  "border-right-color": "color",
  "border-bottom-color": "color",
  "border-left-color": "color",
  "font-size": "length",
  "line-height": "length",
  "letter-spacing": "length",
  margin: "length",
  "margin-top": "length",
  "margin-right": "length",
  "margin-bottom": "length",
  "margin-left": "length",
  padding: "length",
  "padding-top": "length",
  "padding-right": "length",
  "padding-bottom": "length",
  "padding-left": "length",
  gap: "length",
  "row-gap": "length",
  "column-gap": "length",
  width: "length",
  height: "length",
  "min-width": "length",
  "max-width": "length",
  "min-height": "length",
  "max-height": "length",
  "border-radius": "length",
  "border-top-left-radius": "length",
  "border-top-right-radius": "length",
  "border-bottom-right-radius": "length",
  "border-bottom-left-radius": "length",
  top: "length",
  right: "length",
  bottom: "length",
  left: "length",
  "font-weight": "number",
  opacity: "number",
  "z-index": "number",
};

const KNOWN_DEFAULTS: Record<string, string[]> = {
  "margin-top": ["0px"],
  "margin-right": ["0px"],
  "margin-bottom": ["0px"],
  "margin-left": ["0px"],
  "padding-top": ["0px"],
  "padding-right": ["0px"],
  "padding-bottom": ["0px"],
  "padding-left": ["0px"],
  gap: ["normal", "0px", "0px 0px"],
  "row-gap": ["normal", "0px"],
  "column-gap": ["normal", "0px"],
  "letter-spacing": ["normal"],
  "line-height": ["normal"],
  "text-align": ["start", "left"],
  position: ["static"],
  top: ["auto"],
  right: ["auto"],
  bottom: ["auto"],
  left: ["auto"],
  "z-index": ["auto"],
  "flex-direction": ["row"],
  "flex-wrap": ["nowrap"],
  "justify-content": ["normal", "flex-start", "start"],
  "align-items": ["normal", "stretch", "start"],
  opacity: ["1"],
  "background-color": ["rgba(0, 0, 0, 0)", "transparent"],
  "border-style": ["none"],
  "border-top-style": ["none"],
  "border-right-style": ["none"],
  "border-bottom-style": ["none"],
  "border-left-style": ["none"],
  "border-top-width": ["0px"],
  "border-right-width": ["0px"],
  "border-bottom-width": ["0px"],
  "border-left-width": ["0px"],
  "border-top-color": ["rgb(0, 0, 0)", "currentcolor"],
  "border-right-color": ["rgb(0, 0, 0)", "currentcolor"],
  "border-bottom-color": ["rgb(0, 0, 0)", "currentcolor"],
  "border-left-color": ["rgb(0, 0, 0)", "currentcolor"],
  "border-radius": ["0px"],
  "border-top-left-radius": ["0px"],
  "border-top-right-radius": ["0px"],
  "border-bottom-right-radius": ["0px"],
  "border-bottom-left-radius": ["0px"],
  border: ["", "0px none rgb(0, 0, 0)", "none"],
  "min-width": ["auto", "0px"],
  "max-width": ["none"],
  "min-height": ["auto", "0px"],
  "max-height": ["none"],
  width: ["auto"],
  height: ["auto"],
  overflow: ["visible"],
  "overflow-x": ["visible"],
  "overflow-y": ["visible"],
  "text-overflow": ["clip"],
  "white-space": ["normal"],
  "box-shadow": ["none"],
  filter: ["none"],
  "backdrop-filter": ["none"],
  "mix-blend-mode": ["normal"],
  // getComputedStyle은 트랜지션이 없어도 transition-* longhand에 항상 기본값을 돌려준다.
  "transition-property": ["all"],
  "transition-duration": ["0s"],
  "transition-timing-function": ["ease"],
  "transition-delay": ["0s"],
};

export function isKnownDefault(prop: string, computed: string): boolean {
  const value = computed.trim();
  if (prop === "border" && /^0px\s+none\b/.test(value)) return true;
  const defaults = KNOWN_DEFAULTS[prop];
  if (!defaults) return false;
  return defaults.includes(value);
}

const BORDER_COLOR_SIDE = /^border-(top|right|bottom|left)-color$/;

// getComputedStyle은 테두리가 없어도 border-{side}-color를 currentColor의
// resolve값(글자색 rgb)으로 돌려준다 — KNOWN_DEFAULTS의 "currentcolor" 키워드는
// 절대 매칭되지 않아 유령 색이 실제 값처럼 노출된다. 같은 side의 테두리가
// 비활성(style none 또는 width 0px)이면 그 색은 의미 없으므로 기본값으로 취급.
export function isInactiveBorderColor(
  prop: string,
  computedStyles: Record<string, string>,
): boolean {
  const m = BORDER_COLOR_SIDE.exec(prop);
  if (!m) return false;
  const side = m[1];
  const style = computedStyles[`border-${side}-style`];
  const width = computedStyles[`border-${side}-width`];
  if (style != null && style.trim() === "none") return true;
  if (width != null && width.trim() === "0px") return true;
  return false;
}
