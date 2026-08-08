/**
 * 캡처 대상 뷰포트의 폴백 규칙 단일 출처. 캡처 5종이 각자 폴백을 쓰면 한쪽만 고쳐져
 * 모드 ON에서 영상 리포트의 Viewport만 브라우저 폭으로 남는다.
 */
export function resolveCaptureViewport(
  top: { width: number; height: number } | null,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  return top ?? fallback;
}
