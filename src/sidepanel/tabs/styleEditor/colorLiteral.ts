import { NAMED_COLORS } from "@/lib/named-colors";

const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// 함수형 색상. css-resolve.ts의 categorizeToken과 동일 목록(color-mix는 의도적 제외).
const COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\s*\(/i;

export function isRenderableColorLiteral(v: string): boolean {
  const t = v.trim();
  if (!t) return false;
  if (HEX_RE.test(t)) return true;
  if (COLOR_FN_RE.test(t)) return true;
  return NAMED_COLORS.has(t.toLowerCase());
}
