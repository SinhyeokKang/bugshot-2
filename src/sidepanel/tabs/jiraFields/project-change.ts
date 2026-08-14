import type { EditorIssueFields } from "@/store/editor-store";

/**
 * 프로젝트 전환 시 적용할 patch.
 *
 * 비움: issueTypeId·assigneeId·assigneeName·parentKey·parentLabel·relates·sprintId·sprintName —
 * 대상 프로젝트에서 유효하지 않을 수 있는 값들이다(담당자 검색은 site-wide지만 배정 가능 여부는
 * 프로젝트 권한에 묶이고, 스프린트는 보드에·보드는 프로젝트에 묶인다).
 * 유지(patch에 넣지 않음): priorityId·priorityName·cc — 우선순위 스킴은 사이트 전역이고 참조는
 * 본문 멘션일 뿐이라 프로젝트 권한 판정을 받지 않는다.
 *
 * 같은 프로젝트를 다시 고르면 projectKey만 돌려 입력을 보존한다.
 */
export function resolveProjectChange(
  current: Pick<EditorIssueFields, "projectKey">,
  nextProjectKey: string,
): Partial<EditorIssueFields> {
  if (current.projectKey === nextProjectKey) return { projectKey: nextProjectKey };
  return {
    projectKey: nextProjectKey,
    issueTypeId: undefined,
    assigneeId: undefined,
    assigneeName: undefined,
    parentKey: undefined,
    parentLabel: undefined,
    sprintId: undefined,
    sprintName: undefined,
    relates: undefined,
  };
}
