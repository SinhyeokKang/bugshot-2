/**
 * 캡처 대상 뷰포트. `getTopViewport`가 주입 함수로 래퍼를 먼저 찾아보므로 성공값이 곧 정답이고,
 * null(host permission 실패·정책 차단 페이지)이면 기존 `chrome.tabs.get` 값으로 폴백한다.
 *
 * 영상·30s Replay가 이 경로에 새로 편입되면서 폴백 규칙이 두 곳에 생기는 걸 막으려고 함수
 * 하나로 묶었다 — 한쪽만 고쳐지면 모드 ON에서 영상 리포트의 Viewport만 브라우저 폭으로 남는다.
 */
export function resolveCaptureViewport(
  top: { width: number; height: number } | null,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  return top ?? fallback;
}
