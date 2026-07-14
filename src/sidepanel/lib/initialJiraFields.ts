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

// projectKey는 반환하지 않는다 — 제출 시 account.projectKey를 직접 읽고, 여기서 내보내면
// EditorIssueFields에 없는 키가 issueFields로 새어 세션에 영속된다.
export type JiraInitialFields = Omit<JiraLastSubmitFields, "projectKey"> & {
  issueTypeId?: string;
};

export function initialJiraFields(
  last: JiraLastSubmitFields | undefined,
  account: JiraAccountDefaults | undefined,
): JiraInitialFields {
  // project가 갈리면 직전 제출값 전체가 다른 프로젝트의 것이라 무효(담당자·우선순위·상위 이슈 모두).
  const sameProject = !!last?.projectKey && last.projectKey === account?.projectKey;
  const { projectKey: _drop, ...restored } = last ?? ({} as JiraLastSubmitFields);
  const src = sameProject ? restored : {};
  // 담당자는 직전 제출값 우선, 없으면 Connect 탭의 기본 담당자.
  // id·표시명은 한 사람을 가리키는 쌍이라 소스를 통째로 고른다 — 따로 fallback하면 다른 사람 이름이 붙는다.
  const assigneeSrc = src.assigneeId ? src : account;
  return {
    ...src,
    issueTypeId: account?.issueTypeId,
    assigneeId: assigneeSrc?.assigneeId,
    assigneeName: assigneeSrc?.assigneeName,
  };
}
