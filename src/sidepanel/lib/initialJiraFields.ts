import type { JiraLastSubmitFields } from "@/types/platform";

// Jira project는 이제 연동 설정이 아니라 **제출 목적지 필드**다 — account.projectKey는 기본값으로
// 강등되고 직전 제출값이 우선한다(POSTMORTEM 2026-06-30: 제출 목적지 필드는 last 우선, defaults는
// fallback). 그래서 projectKey를 반환한다 — 직전 제출값은 한 프로젝트의 스냅샷이라 프로젝트까지
// 함께 복원해야 하위 필드와의 정합이 맞는다. 남는 게이트는 사이트 일치 하나뿐이다.
// 다른 플랫폼의 initial*Fields와 대칭을 맞추려고 editor-store.confirmDraft의 인라인 로직을 분리했다.

export interface JiraAccountDefaults {
  projectKey?: string;
  issueTypeId?: string;
  assigneeId?: string;
  assigneeName?: string;
}

// siteId는 판별자일 뿐이라 반환하지 않는다 — EditorIssueFields에 없는 키가 issueFields로 새면
// 세션에 영속된다.
export type JiraInitialFields = Omit<JiraLastSubmitFields, "siteId">;

/**
 * currentSiteId: jiraSiteId(account.auth). 직전 제출값이 다른 사이트 것이면 통째로 버린다.
 * 미지정이면 사이트 검증을 건너뛴다(계정 미연결 경로 + 마이그레이션이 없어 siteId가 없는 기존 레코드).
 */
export function initialJiraFields(
  last: JiraLastSubmitFields | undefined,
  account: JiraAccountDefaults | undefined,
  currentSiteId?: string,
): JiraInitialFields {
  const sameSite = !last?.siteId || !currentSiteId || last.siteId === currentSiteId;
  const { siteId: _drop, ...restored } = last ?? ({} as JiraLastSubmitFields);
  const src = last && sameSite ? restored : ({} as JiraInitialFields);
  const projectKey = src.projectKey ?? account?.projectKey;
  // 계정 기본 이슈타입·담당자는 그 계정 기본 프로젝트의 것이다. 다른 프로젝트로 열면서 주입하면
  // 대상 프로젝트에 없는 이슈타입으로 제출해 400이 된다.
  const isDefaultProject = !!projectKey && projectKey === account?.projectKey;
  // 담당자 id·표시명은 한 사람을 가리키는 쌍이라 소스를 통째로 고른다 — 따로 fallback하면 다른
  // 사람 이름이 붙는다.
  const assigneeSrc = src.assigneeId ? src : isDefaultProject ? account : undefined;
  return {
    ...src,
    projectKey,
    issueTypeId: src.issueTypeId ?? (isDefaultProject ? account?.issueTypeId : undefined),
    assigneeId: assigneeSrc?.assigneeId,
    assigneeName: assigneeSrc?.assigneeName,
  };
}
