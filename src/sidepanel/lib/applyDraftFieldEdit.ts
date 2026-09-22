import type { IssueRecord } from "@/store/issues-store";
import type { TextIssueSection } from "./bodyBlocks";

export type DraftEditTarget =
  | { kind: "title"; value: string }
  | { kind: "section"; section: TextIssueSection; value: string };

/**
 * 편집 결과를 patchIssue용 부분 패치로 계산.
 * - title: 최상위 title + draft.title 동시 갱신(리스트/검색 정합).
 * - section: draft.sections[id] 갱신.
 * - draft는 기존 issue.draft 전체를 스프레드해 재구성(patchIssue 얕은 병합 대응).
 * - updatedAt은 싣지 않는다 — patchIssue가 스프레드 뒤에 Date.now()로 덮으므로 여기서 주면
 *   항상 폐기된다. id도 patch에 넣지 않는다(prefill effect deps 트랩 회피).
 * - 원본 issue는 변경하지 않는다(불변).
 */
export function applyDraftFieldEdit(
  issue: IssueRecord,
  target: DraftEditTarget,
  nextValue: string,
): Partial<IssueRecord> {
  if (target.kind === "title") {
    return {
      title: nextValue,
      draft: { ...issue.draft, title: nextValue },
    };
  }
  return {
    draft: {
      ...issue.draft,
      sections: { ...issue.draft.sections, [target.section.id]: nextValue },
    },
  };
}
