// 자동완성 드롭다운의 값 미리보기용 — label이 유효한 색이면 그 문자열, 아니면 null.
// CSS-wide 키워드(inherit/initial/unset/revert…)는 색이 아니므로 제외(에디터 인라인 swatch와 동일 규율).
const CSS_WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

export function swatchColorFor(
  label: string,
  supports: (c: string) => boolean = (c) => CSS.supports("color", c),
): string | null {
  const v = label.trim();
  if (!v || CSS_WIDE.has(v.toLowerCase())) return null;
  return supports(v) ? v : null;
}
