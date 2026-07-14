import type { JiraLastSubmitFields } from "@/types/platform";

// Jira는 project가 이슈 필드가 아니라 Connect 계정 설정(account.projectKey)이고 그게 진실이다
// — Asana/ClickUp의 workspace와 같은 위상(거친 스코프). 그래서 project는 account 우선이고,
// assignee는 그 project 하위 필드로 last 우선·account fallback이 된다.
// 다른 플랫폼의 initial*Fields와 대칭을 맞추려고 editor-store.confirmDraft의 인라인 로직을 분리했다.

export interface JiraAccountDefaults {
  projectKey?: string;
  issueTypeId?: string;
  assigneeId?: string;
  assigneeName?: string;
}

export type JiraInitialFields = Omit<JiraLastSubmitFields, "projectKey"> & {
  projectKey?: string;
  issueTypeId?: string;
};

export function initialJiraFields(
  last: JiraLastSubmitFields | undefined,
  account: JiraAccountDefaults | undefined,
): JiraInitialFields {
  const projectKey = account?.projectKey;
  // project가 갈리면 직전 제출값 전체가 다른 프로젝트의 것이라 무효(담당자·우선순위·상위 이슈 모두).
  const sameProject = !!last?.projectKey && last.projectKey === projectKey;
  const { projectKey: _drop, ...restored } = sameProject ? last! : ({} as JiraLastSubmitFields);
  return {
    ...restored,
    projectKey,
    issueTypeId: account?.issueTypeId,
    // 담당자는 직전 제출값 우선, 없으면 Connect 탭의 기본 담당자.
    assigneeId: restored.assigneeId ?? account?.assigneeId,
    assigneeName: restored.assigneeName ?? account?.assigneeName,
  };
}
