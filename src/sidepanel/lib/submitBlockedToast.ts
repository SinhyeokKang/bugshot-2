import { toast } from "sonner";
import type { TranslationFn } from "@/i18n";
import { IssueAlreadySubmittedError } from "@/store/issues-store";

// 재클릭마다 toast가 쌓이지 않게 고정 id로 대체한다 — 차단돼도 [제출]은 계속 눌린다.
const TOAST_ID = "submit-already-submitted";

/**
 * 이미 제출된 이슈의 재제출 차단을 알린다. 처리했으면 true.
 *
 * toast를 여기서 치는 건 그물 때문이다 — 소비처(`SubmitFieldsDialog`)는 어댑터 8개를 모킹해야
 * 렌더되는 컴포넌트라, 문구 선택만 헬퍼로 빼고 표시를 컴포넌트에 남기면 `titleParams`·
 * `description` 누락이 전 스위트 green으로 통과한다(실측). `llmErrorToast`와 같은 형태다.
 */
export function toastSubmitBlocked(err: unknown, t: TranslationFn): boolean {
  if (!(err instanceof IssueAlreadySubmittedError)) return false;
  toast.error(
    err.issueKey
      ? t("submit.alreadySubmittedAs", { key: err.issueKey })
      : t("submit.alreadySubmitted"),
    { description: t("submit.alreadySubmittedHint"), id: TOAST_ID },
  );
  return true;
}
