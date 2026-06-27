import { isKnownDefault } from "@/sidepanel/tabs/styleEditor/propMetadata";

// 스타일 섹션 초기 펼침: 섹션 prop 중 하나라도 "값이 있으면" 펼친다.
// - specified에 키가 있으면(author가 명시) 무조건 값으로 간주.
// - 아니면 computed가 빈값이 아니고 알려진 기본값(display:block, margin 0 등)도 아니면 값으로 간주.
export function sectionDefaultOpen(
  props: readonly string[],
  specifiedStyles: Record<string, string>,
  computedStyles: Record<string, string>,
): boolean {
  return props.some((p) => {
    if (p in specifiedStyles) return true;
    const v = computedStyles[p];
    return v != null && v !== "" && !isKnownDefault(p, v);
  });
}
