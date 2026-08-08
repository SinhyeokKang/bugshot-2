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

// before에서 확정한 캡처 기준. after가 같은 대상을 다시 측정하는 데 쓴다.
export interface CaptureContext {
  // 확장 성공 시 조상 selector. null이면 폴백 경로.
  contextSelector: string | null;
  // 폴백 경로에서 요소 rect가 0×0이 됐을 때 재사용할 before 시점 rect.
  rect: ViewportRect;
  viewport: { width: number; height: number };
  // before 시점의 스크롤. 0×0 폴백에서 좌표 신뢰 여부를 판정한다.
  scrollX: number;
  scrollY: number;
}

export interface PrepareCaptureResponse {
  rect: ViewportRect | null;
  viewport: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  // 필수다 — optional이면 응답을 손으로 조립하다 빠뜨려도 컴파일이 통과하는데, 유실된
  // 확장 판정은 before/after 기준을 조용히 가른다(POSTMORTEM 2026-08-07).
  contextSelector: string | null;
}

export interface PageMetrics {
  scrollHeight: number;
  viewport: { width: number; height: number };
  // 캡처 전 스티치 계획 단계에서 canvas 높이 한계를 검사해야 해 페이지에서 함께 받는다.
  devicePixelRatio: number;
}

export interface ScrollAck {
  // 실제 도달한 scrollY — 문서 끝에서 클램프될 수 있어 스티치 겹침 보정에 쓴다.
  y: number;
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

/**
 * device.set의 응답. **"래퍼 DOM을 만들었는가/지웠는가"이고 로드 성공 여부가 아니다** —
 * XFO/CSP 성공·차단 판정은 background가 하므로 reason 필드를 두지 않는다.
 */
export interface DeviceSetResponse {
  ok: boolean;
  width: number | null;
  available: { width: number; height: number };
}

export interface DeviceStateResponse {
  width: number | null;
  available: { width: number; height: number };
  /**
   * 사용자가 지금 보는 주소. 모드 ON이면 래퍼의 것, OFF면 top의 것이다 — 래퍼 안 이동은
   * top URL을 안 바꾸므로 `chrome.tabs.get().url`은 이 값의 대체가 못 된다.
   */
  pageUrl: string;
}

export type PickerMessage =
  | { type: "ping" }
  // ── 디바이스 뷰포트 (수신 3종은 전부 top 한정 — 각 case 첫 줄이 window !== window.top을 튕긴다)
  // title은 래퍼 iframe의 접근명이다 — content script는 i18n 사전을 못 읽으므로
  // 사이드패널이 로케일에 맞춰 조립해 실어 보낸다.
  | { type: "device.set"; width: number | null; title: string } // null = 전체(래퍼 제거 + reload)
  | { type: "device.state" }
  | { type: "device.watch"; on: boolean } // on:false가 unwatch다. 별도 타입을 두지 않는다
  // ── push 2종
  | { type: "device.availableChanged"; available: { width: number; height: number } }
  // 래퍼 프레임 자신이 발화. 래퍼 frameId는 payload가 아니라 sender.frameId에서 얻는다.
  | { type: "device.frameReady" }
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
  | { type: "picker.selectByPath"; selector: string; sessionId?: string }
  | { type: "picker.applyEditsBySelector"; selector: string; classList: string[]; inlineStyle: Record<string, string>; text: string | null }
  // contextSelector는 before가 확정한 조상 — after가 같은 대상을 다시 측정한다.
  | { type: "picker.prepareCapture"; expandContext?: boolean; contextSelector?: string }
  | { type: "picker.prepareCaptureBySelector"; selector: string; expandContext?: boolean; contextSelector?: string }
  // iframe 캡처 직전 top(frame 0)에 전송 — offset 응답기를 1회성 arm. 페이지가 위조할 수
  // 없는 chrome 메시지 경로라 무인증 postMessage 요청의 top 부작용(overlay 숨김)을 차단.
  | { type: "picker.armFrameOffset" }
  | { type: "picker.pageUrl" }
  // cleanup: iframe 캡처 종료 시 frame 0에 보내는 정리 신호 — 미소비 arm이면 top이
  // inflight를 깎지 않는다(인터리브 중 진행 캡처의 overlay 조기 복원 방지).
  | { type: "picker.endCapture"; cleanup?: boolean }
  | { type: "picker.startAreaSelect"; restoreAfter?: boolean; sessionId: string }
  | { type: "picker.cancelAreaSelect" }
  | { type: "picker.selectFullViewport" }
  | { type: "picker.beginScrollCapture" }
  | { type: "picker.scrollCaptureTo"; y: number; hideFixed: boolean }
  | { type: "picker.endScrollCapture" }
  | { type: "picker.selected"; sessionId: string; source: "pick" | "navigate" | "rebind"; payload: PickerSelectionPayload }
  | { type: "picker.selectionUpdated"; sessionId: string; payload: PickerSelectionUpdatePayload }
  | { type: "picker.cancelled"; sessionId: string }
  | { type: "picker.iframeUnsupported"; sessionId: string }
  | { type: "picker.selectionDetached"; sessionId: string }
  | { type: "picker.areaSelected"; rect: ViewportRect; viewport: { width: number; height: number }; sessionId?: string }
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
  | { type: "actionRecorder.data"; payload: { entries: import("@/types/action").ActionEntry[]; totalSeen: number } }
  | { type: "annotation.show" }
  | { type: "annotation.hide" }
  // pen/highlight면 color/strokeWidth/opacity(sidepanel 계산)를 싣고, off는 tool:null만 보낸다.
  | { type: "annotation.setTool"; tool: "pen" | "rect" | "highlight"; color: string; strokeWidth: number; opacity: number }
  | { type: "annotation.setTool"; tool: null }
  | { type: "annotation.penOff" };
