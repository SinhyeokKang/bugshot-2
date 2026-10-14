import type { TranslationKey } from "@/i18n/ko";
import { onCaptureFailed, type CaptureFailureKind } from "@/lib/app-events";
import {
  SCROLL_CAPTURE_ABORTED_MESSAGE,
  isCaptureInactiveError,
  isCaptureRateLimitError,
} from "@/lib/capture-messages";

export type { CaptureFailureKind } from "@/lib/app-events";

// captureVisibleTab/tabCapture가 activeTab grant 만료로 거부될 때의 에러 메시지를 식별한다.
export function isActiveTabPermissionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("activetab") ||
    msg.includes("all_urls") ||
    msg.includes("extension has not been invoked")
  );
}

// null = 토스트 없음. 권한 만료는 기존 다이얼로그가, 취소는 사용자가 이미 안다.
export function classifyCaptureFailure(err: unknown): CaptureFailureKind | null {
  if (isActiveTabPermissionError(err)) return null;
  if (err instanceof Error && err.message === SCROLL_CAPTURE_ABORTED_MESSAGE) return null;
  if (isCaptureInactiveError(err)) return "inactive";
  if (isCaptureRateLimitError(err)) return "rate-limit";
  return "other";
}

export const CAPTURE_FAILURE_KEYS: Record<CaptureFailureKind, TranslationKey> = {
  inactive: "issue.captureFailed.inactive",
  "rate-limit": "issue.captureFailed.rateLimit",
  "element-missing": "issue.captureFailed.elementMissing",
  other: "issue.captureFailed.other",
};

// 페이지 이동으로 activeTab이 풀렸는데 진행 중 세션이라 다이얼로그를 idle 복귀까지 미룬 상태.
// 그 사이 캡처 실패는 같은 원인이라 토스트까지 띄우면 알림이 둘이 된다.
let activeTabExpiryDeferred = false;

export function setActiveTabExpiryDeferred(on: boolean): void {
  activeTabExpiryDeferred = on;
}

export function isActiveTabExpiryDeferred(): boolean {
  return activeTabExpiryDeferred;
}

export function emitCaptureFailure(kind: CaptureFailureKind): void {
  if (activeTabExpiryDeferred) return;
  onCaptureFailed.fire(kind);
}

export function fireCaptureFailure(err: unknown): void {
  const kind = classifyCaptureFailure(err);
  if (kind) emitCaptureFailure(kind);
}
