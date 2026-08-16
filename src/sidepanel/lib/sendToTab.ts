import type { PickerMessage } from "@/types/picker";

// 사이드패널 → content script 단방향 알림. 탭이 닫혔거나 content script가 안 깔린 건
// 정상 경로라 삼킨다 — 여기서 throw하면 레코더 정리·오버레이 숨김 같은 뒷정리가 끊긴다.
export async function sendToTab(tabId: number, msg: PickerMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // 탭 닫힘·content script 미주입 — 조용히 무시
  }
}
