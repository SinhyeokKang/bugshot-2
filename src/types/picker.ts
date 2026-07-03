export interface PickerSelectionUpdatePayload {
  selector: string;
  specifiedStyles: Record<string, string>;
  propSources: Record<string, string>;
  computedStyles: Record<string, string>;
}

export interface PickerSelectionPayload {
  selector: string;
  tagName: string;
  classList: string[];
  computedStyles: Record<string, string>;
  specifiedStyles: Record<string, string>;
  propSources: Record<string, string>;
  hasParent: boolean;
  hasChild: boolean;
  text: string | null;
  viewport: { width: number; height: number };
  // frameId·origin은 페이로드가 아니라 sender(frameId·origin)에서 얻는다(위조 방지).
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrepareCaptureResponse {
  rect: ViewportRect | null;
  viewport: { width: number; height: number };
}

export type TokenCategory =
  | "color"
  | "length"
  | "number"
  | "image"
  | "unknown";

export interface Token {
  name: string;
  value: string;
  category: TokenCategory;
}

export interface PickerTokensResponse {
  tokens: Token[];
}

export interface TreeNode {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  childCount: number;
  children?: TreeNode[];
}

export interface DescribeInitialResponse {
  tree: TreeNode;
  ancestorPath: string[];
}

export interface DescribeChildrenResponse {
  children: TreeNode[];
}

export type PickerMessage =
  | { type: "ping" }
  // frameToken: 전 프레임 broadcast로 공유되는 PRESENT 등록 인증 토큰 — 자식 announce에
  // 실리고 top이 검증한다(페이지가 볼 수 없는 chrome 경로라 위조 등록 차단).
  | { type: "picker.start"; frameToken?: string }
  | { type: "picker.stop" }
  | { type: "picker.clear" }
  | { type: "picker.navigate"; direction: "parent" | "child" }
  | { type: "picker.applyClasses"; classList: string[] }
  | { type: "picker.applyStyles"; inlineStyle: Record<string, string> }
  | { type: "picker.applyText"; text: string }
  | { type: "picker.resetAllEdits" }
  | { type: "picker.collectTokens" }
  | { type: "picker.describeInitial" }
  | { type: "picker.describeChildren"; selector: string }
  | { type: "picker.previewHover"; selector: string }
  | { type: "picker.previewClear" }
  | { type: "picker.selectByPath"; selector: string }
  | { type: "picker.applyEditsBySelector"; selector: string; classList: string[]; inlineStyle: Record<string, string>; text: string | null }
  | { type: "picker.prepareCapture" }
  | { type: "picker.prepareCaptureBySelector"; selector: string }
  // iframe 캡처 직전 top(frame 0)에 전송 — offset 응답기를 1회성 arm. 페이지가 위조할 수
  // 없는 chrome 메시지 경로라 무인증 postMessage 요청의 top 부작용(overlay 숨김)을 차단.
  | { type: "picker.armFrameOffset" }
  | { type: "picker.pageUrl" }
  // cleanup: iframe 캡처 종료 시 frame 0에 보내는 정리 신호 — 미소비 arm이면 top이
  // inflight를 깎지 않는다(인터리브 중 진행 캡처의 overlay 조기 복원 방지).
  | { type: "picker.endCapture"; cleanup?: boolean }
  | { type: "picker.startAreaSelect"; restoreAfter?: boolean }
  | { type: "picker.cancelAreaSelect" }
  | { type: "picker.selected"; payload: PickerSelectionPayload }
  | { type: "picker.selectionUpdated"; payload: PickerSelectionUpdatePayload }
  | { type: "picker.cancelled" }
  | { type: "picker.iframeUnsupported" }
  | { type: "picker.areaSelected"; rect: ViewportRect; viewport: { width: number; height: number } }
  | { type: "networkRecorder.setSentinel"; sentinel: string }
  | { type: "networkRecorder.stop" }
  | { type: "networkRecorder.sync" }
  | { type: "networkRecorder.clear" }
  | { type: "networkRecorder.data"; payload: { requests: import("@/types/network").NetworkRequest[]; totalSeen: number; warnings: import("@/types/network").NetworkLog["warnings"] } }
  | { type: "consoleRecorder.setSentinel"; sentinel: string }
  | { type: "consoleRecorder.stop" }
  | { type: "consoleRecorder.sync" }
  | { type: "consoleRecorder.clear" }
  | { type: "consoleRecorder.data"; payload: { entries: import("@/types/console").ConsoleEntry[]; totalSeen: number } }
  | { type: "actionRecorder.setSentinel"; sentinel: string }
  | { type: "actionRecorder.stop" }
  | { type: "actionRecorder.sync" }
  | { type: "actionRecorder.clear" }
  | { type: "actionRecorder.data"; payload: { entries: import("@/types/action").ActionEntry[]; totalSeen: number } };
