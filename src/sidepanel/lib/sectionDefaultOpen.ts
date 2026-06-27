// 스타일 섹션의 초기 펼침 상태 판정.
// specified(author rule) 정보가 하나라도 있으면 그 기준으로 펼친다(same-origin 일반 동작).
// specified가 전무하면(cross-origin stylesheet라 cssRules/fetch가 막힌 경우 등)
// computed fallback으로 값이 있는 섹션을 펼쳐 "값은 있는데 접혀 안 보임"을 방지.
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
