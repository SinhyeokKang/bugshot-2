import type { CaptureMode } from "./buildCaptureFiles";
import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import type { ActionLog } from "@/types/action";

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

// 지원 모드에서 로그가 0건이어도 null이 아니라 빈 객체를 내보내기 위한 상수.
// null은 "이 캡처 모드에서 미수집"만 뜻하도록 의미를 좁힌다(0건 아님).
export const EMPTY_CONSOLE_LOG: ConsoleLog = {
  id: "",
  startedAt: 0,
  endedAt: 0,
  totalSeen: 0,
  captured: 0,
  entries: [],
};

export const EMPTY_NETWORK_LOG: NetworkLog = {
  id: "",
  startedAt: 0,
  endedAt: 0,
  totalSeen: 0,
  captured: 0,
  warnings: [],
  requests: [],
};

export const EMPTY_ACTION_LOG: ActionLog = {
  id: "",
  startedAt: 0,
  endedAt: 0,
  totalSeen: 0,
  captured: 0,
  entries: [],
};

// 캡처 로그를 logs.html용으로 정규화: 미지원 → null / 지원+수집 → 원본 / 지원+0건 → 빈 객체.
export function resolveCapturedLog<T>(
  raw: T | null | undefined,
  supported: boolean,
  empty: T,
): T | null {
  if (!supported) return null;
  return raw ?? empty;
}
