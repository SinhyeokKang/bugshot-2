import type { CaptureMode } from "./buildCaptureFiles";

// 캡처 모드별 로그 지원 매트릭스 (단일 진실 — UI 카드 표시 / blob 로드 / submit 첨부 모두 이 기준).
// element: 로그 없음
// screenshot, freeform, video: console + network + action 지원
//
// 세 로그는 같은 시계 위에 올라가야 재현에 쓸모가 있다("무엇을 했나" ↔ "앱이 뭘 했나").
// 액션만 다른 스코프를 가지면 콘솔 에러 옆에 있어야 할 클릭이 사라진다.

export function supportsConsoleNetworkLog(mode: CaptureMode | undefined): boolean {
  return mode === "screenshot" || mode === "freeform" || mode === "video";
}

export function supportsActionLog(mode: CaptureMode | undefined): boolean {
  return mode === "screenshot" || mode === "freeform" || mode === "video";
}
