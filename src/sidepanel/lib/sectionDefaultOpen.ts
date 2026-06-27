// 스타일 섹션 초기 펼침: specified가 있으면 그 기준, 전무하면(cross-origin sheet 등)
// computed fallback으로 값 있는 섹션을 펼쳐 "값 있는데 접혀 안 보임" 방지.
export function sectionDefaultOpen(
  props: readonly string[],
  specifiedStyles: Record<string, string>,
  computedStyles: Record<string, string>,
): boolean {
  if (Object.keys(specifiedStyles).length > 0) {
    return props.some((p) => p in specifiedStyles);
  }
  return props.some((p) => {
    const v = computedStyles[p];
    return v != null && v !== "";
  });
}
