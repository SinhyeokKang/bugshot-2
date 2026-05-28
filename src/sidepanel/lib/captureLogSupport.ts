import type { CaptureMode } from "./buildCaptureFiles";

// 캡처 모드별 로그 지원 매트릭스 (단일 진실 — UI 카드 표시 / blob 로드 / submit 첨부 모두 이 기준).
// element: 로그 없음
// screenshot, freeform, video: console + network 지원
// video: action 추가 지원

export function supportsConsoleNetworkLog(mode: CaptureMode | undefined): boolean {
  return mode === "screenshot" || mode === "freeform" || mode === "video";
}

export function supportsActionLog(mode: CaptureMode | undefined): boolean {
  return mode === "video";
}
