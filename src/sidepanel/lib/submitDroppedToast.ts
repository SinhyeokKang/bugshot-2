import { toast } from "sonner";
import type { TranslationFn } from "@/i18n";

// 기본 4초는 이 경고의 유일한 노출 창이다 — SubmitSuccessView엔 경고 슬롯이 없고
// [확인]이면 reset()으로 끝난다. DESIGN §14가 "토스트가 대기보다 먼저 사라져 경고가
// 증발했다"를 같은 형태로 기록해 뒀다.
const DURATION_MS = 8000;

/**
 * 제출은 됐지만 첨부가 용량 한도로 빠졌을 때 알린다. 띄웠으면 true.
 *
 * **두 축을 한 토스트로 친다.** 쪼개면 sonner 기본(`expand=false`)에서 뒤 토스트 내용이
 * `opacity: 0`으로 가려지고, `ui/sonner.tsx`의 클릭 핸들러가 인자 없는 `toast.dismiss()`라
 * 보이는 쪽을 닫으면 아직 못 읽은 쪽까지 함께 사라진다.
 *
 * 문구 선택만 빼고 표시를 컴포넌트에 남기면 누락이 전 스위트 green으로 통과한다 —
 * `submitBlockedToast`·`llmErrorToast`와 같은 형태다.
 */
export function toastSubmitDropped(
  result: { key: string; mediaDropped?: boolean; logsDropped?: boolean },
  platform: string,
  t: TranslationFn,
): boolean {
  const lines: string[] = [];
  // 캡처가 먼저다 — 본문에서 빠진 게 더 크게 보이는 쪽이고, 한 줄만 보이는 자리가 title이다.
  if (result.mediaDropped) lines.push(t("submit.mediaDropped", { platform }));
  if (result.logsDropped) lines.push(t("submit.logsDropped", { platform }));
  if (lines.length === 0) return false;

  toast.warning(lines[0], {
    ...(lines[1] ? { description: lines[1] } : {}),
    duration: DURATION_MS,
    id: `submit-dropped-${result.key}`,
  });
  return true;
}
