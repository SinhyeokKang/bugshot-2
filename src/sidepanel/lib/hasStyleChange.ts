import type {
  StyleDiffSelection,
  StyleDiffEdits,
} from "@/sidepanel/components/StyleChangesTable";

// styling→drafting 진입 게이트 판정. StyleEditorPanel의 인라인 hasChange 계산식을 순수
// 헬퍼로 추출한 것. buildStyleDiff(selection, edits).length > 0 과 >0 경계에서 동치다
// (shorthand collapse는 비어있지 않은 입력을 0으로 만들지 않음 — 단위 테스트로 고정).
export function hasStyleChange(
  selection: StyleDiffSelection,
  edits: StyleDiffEdits,
): boolean {
  const inlineCount = Object.keys(edits.inlineStyle).length;
  const classDirty =
    selection.classList.length !== edits.classList.length ||
    selection.classList.some((c, i) => c !== edits.classList[i]);
  const textDirty = selection.text !== null && edits.text !== selection.text;
  return inlineCount > 0 || classDirty || textDirty;
}
