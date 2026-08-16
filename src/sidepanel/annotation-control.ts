import { sendToTab } from "@/sidepanel/lib/sendToTab";
import { overlayStrokeStyle, type RecordingPenTool } from "./components/annotation/recording-pen";
import type { ThicknessKey } from "./components/annotation/presets";

// 녹화 중 어노테이션 오버레이 제어 senders. annotation은 picker 엔트리 내부 모듈이라
// 별도 주입 보장 불필요(picker-control의 ensureContentScript가 이미 마운트). recorder-control과
// 동일하게 useEditorStore 비의존이라 순환 import 없음.
export async function showAnnotation(tabId: number): Promise<void> {
  await sendToTab(tabId, { type: "annotation.show" });
}

export async function hideAnnotation(tabId: number): Promise<void> {
  await sendToTab(tabId, { type: "annotation.hide" });
}

// tool=null → 그리기 off. 그 외엔 tool·color·thickness로 획 스타일(strokeWidth/opacity)을 계산해 전송.
export async function setAnnotationTool(
  tabId: number,
  tool: RecordingPenTool | null,
  color: string,
  thickness: ThicknessKey,
): Promise<void> {
  if (tool === null) {
    await sendToTab(tabId, { type: "annotation.setTool", tool: null });
    return;
  }
  const { strokeWidth, opacity } = overlayStrokeStyle(tool, thickness);
  await sendToTab(tabId, { type: "annotation.setTool", tool, color, strokeWidth, opacity });
}
