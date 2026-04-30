export interface PickerSelectionUpdatePayload {
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
  | { type: "picker.start" }
  | { type: "picker.stop" }
  | { type: "picker.clear" }
  | { type: "picker.navigate"; direction: "parent" | "child" }
  | { type: "picker.applyClasses"; classList: string[] }
  | { type: "picker.applyStyles"; inlineStyle: Record<string, string> }
  | { type: "picker.applyText"; text: string }
  | { type: "picker.resetEdits" }
  | { type: "picker.collectTokens" }
  | { type: "picker.describeInitial" }
  | { type: "picker.describeChildren"; selector: string }
  | { type: "picker.previewHover"; selector: string }
  | { type: "picker.previewClear" }
  | { type: "picker.selectByPath"; selector: string }
  | { type: "picker.prepareCapture" }
  | { type: "picker.endCapture" }
  | { type: "picker.startAreaSelect" }
  | { type: "picker.cancelAreaSelect" }
  | { type: "picker.selected"; payload: PickerSelectionPayload }
  | { type: "picker.selectionUpdated"; payload: PickerSelectionUpdatePayload }
  | { type: "picker.cancelled" }
  | { type: "picker.iframeUnsupported" }
  | { type: "picker.areaSelected"; rect: ViewportRect; viewport: { width: number; height: number } }
  | { type: "networkRecorder.setSentinel"; sentinel: string }
  | { type: "networkRecorder.stop" }
  | { type: "networkRecorder.sync" }
  | { type: "networkRecorder.data"; payload: { requests: import("@/types/network").NetworkRequest[]; totalSeen: number; warnings: import("@/types/network").NetworkLog["warnings"] } };
