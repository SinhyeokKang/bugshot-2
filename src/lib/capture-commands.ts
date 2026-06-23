interface CaptureGateState {
  phase: string;
  captureMode: string;
  selection: unknown | null;
}

/**
 * 캡처 진입 화면이 보이는 상태인지 판정하는 게이트 단일 출처.
 * 진입 화면 = phase==="idle" || (captureMode==="element" && !selection).
 * IssueTab.tsx(EmptyState 렌더 분기)가 사용한다.
 */
export function isCaptureEntryScreen(state: CaptureGateState): boolean {
  return state.phase === "idle" || (state.captureMode === "element" && !state.selection);
}
