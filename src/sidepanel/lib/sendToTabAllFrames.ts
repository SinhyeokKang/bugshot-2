import type { PickerMessage } from "@/types/picker";

// 사이드패널 → content script 단방향 알림. **frameId를 안 싣는다 = 전 프레임 broadcast**이므로
// 프레임 무관 메시지 전용이다(레코더 제어·annotation 오버레이). 특정 프레임에 보내야 하면
// picker-control의 send(tabId, msg, frameId)를 쓴다 — 거기서 frameId가 required인 이유가
// 정확히 이 함정이다. 탭이 닫혔거나 content script가 안 깔린 건 정상 경로라 삼킨다;
// 여기서 throw하면 레코더 정리·오버레이 숨김 같은 뒷정리가 끊긴다.
export async function sendToTabAllFrames(tabId: number, msg: PickerMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // 탭 닫힘·content script 미주입 — 조용히 무시
  }
}
