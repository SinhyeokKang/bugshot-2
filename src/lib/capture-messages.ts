// 캡처 관문 실패 메시지의 단일 출처. background(capture-throttle)가 throw하고 사이드패널
// (scroll-capture·capture-error)이 분류하므로, 양쪽 realm이 함께 무는 leaf다 — 런타임 import 0.

export const CAPTURE_NO_WINDOW_MESSAGE = "tab has no window";

export function captureInactiveMessage(tabId: number): string {
  return `tab ${tabId} is no longer the active tab`;
}

export const SCROLL_TAB_INACTIVE_MESSAGE = "tab is not active";

export const SCROLL_CAPTURE_ABORTED_MESSAGE = "scroll capture aborted";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const INACTIVE_RE = /^tab \d+ is no longer the active tab$/;

export function isCaptureInactiveError(err: unknown): boolean {
  const msg = messageOf(err);
  return (
    INACTIVE_RE.test(msg) ||
    msg === SCROLL_TAB_INACTIVE_MESSAGE ||
    msg === CAPTURE_NO_WINDOW_MESSAGE
  );
}

export function isCaptureRateLimitError(err: unknown): boolean {
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(messageOf(err));
}
