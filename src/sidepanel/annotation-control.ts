import type { PickerMessage } from "@/types/picker";

// 녹화 중 어노테이션 오버레이 제어 senders. annotation은 picker 엔트리 내부 모듈이라
// 별도 주입 보장 불필요(picker-control의 ensureContentScript가 이미 마운트). recorder-control과
// 동일하게 useEditorStore 비의존이라 순환 import 없음.
async function send(tabId: number, msg: PickerMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // 탭 닫힘·content script 미주입 — 조용히 무시
  }
}

export async function showAnnotation(tabId: number): Promise<void> {
  await send(tabId, { type: "annotation.show" });
}

export async function hideAnnotation(tabId: number): Promise<void> {
  await send(tabId, { type: "annotation.hide" });
}

export async function setAnnotationPen(tabId: number, on: boolean): Promise<void> {
  await send(tabId, { type: "annotation.setPen", on });
}
