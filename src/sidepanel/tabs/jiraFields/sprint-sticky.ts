import { isActiveSprint } from "@/lib/jira-sprint";
import type { EditorIssueFields } from "@/store/editor-store";
import type { JiraSprint } from "@/types/jira";

/**
 * 직전 제출에서 복원된 스프린트가 아직 유효한지 판정해 적용할 patch를 돌려준다.
 *
 * 유효 상태를 화이트리스트로 통과시킨다(닫힌 상태를 열거해 거르는 게 아니다) — 미지의 상태
 * 문자열이 유효로 새면 이미 끝난 스프린트로 제출된다.
 */
export function resolveStickySprint(
  current: Pick<EditorIssueFields, "sprintId" | "sprintName">,
  fetched: JiraSprint | null,
): Partial<EditorIssueFields> | null {
  if (current.sprintId == null) return null;
  if (!fetched || !isActiveSprint(fetched.state)) {
    return { sprintId: undefined, sprintName: undefined };
  }
  if (fetched.name === current.sprintName) return null;
  return { sprintName: fetched.name };
}
