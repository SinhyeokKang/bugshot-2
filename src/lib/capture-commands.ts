export const CAPTURE_SHORTCUT_MSG = "shortcut.capture";

export type CaptureCommand =
  | "capture-element"
  | "capture-screenshot"
  | "capture-video";

export type CaptureAction = "element" | "screenshot" | "video";

export const CAPTURE_COMMANDS: readonly CaptureCommand[] = [
  "capture-element",
  "capture-screenshot",
  "capture-video",
];

const COMMAND_ACTION: Record<CaptureCommand, CaptureAction> = {
  "capture-element": "element",
  "capture-screenshot": "screenshot",
  "capture-video": "video",
};

export interface CaptureShortcutMessage {
  type: typeof CAPTURE_SHORTCUT_MSG;
  command: CaptureCommand;
  tabId: number;
}

interface CaptureGateState {
  phase: string;
  captureMode: string;
  selection: unknown | null;
}

/**
 * 캡처 진입 화면이 보이는 상태인지 판정하는 게이트 단일 출처.
 * 진입 화면 = phase==="idle" || (captureMode==="element" && !selection).
 * IssueTab.tsx(EmptyState 렌더 분기)와 resolveCaptureShortcut 양쪽이 공유한다.
 */
export function isCaptureEntryScreen(state: CaptureGateState): boolean {
  return state.phase === "idle" || (state.captureMode === "element" && !state.selection);
}

/**
 * 커맨드 + 에디터 상태 → 실행할 캡처 액션, 또는 게이트 미통과/미지 커맨드면 null.
 */
export function resolveCaptureShortcut(
  command: string,
  state: CaptureGateState,
): CaptureAction | null {
  if (!(command in COMMAND_ACTION)) return null;
  if (!isCaptureEntryScreen(state)) return null;
  return COMMAND_ACTION[command as CaptureCommand];
}
