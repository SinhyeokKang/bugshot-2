import { sendToTabAllFrames } from "@/sidepanel/lib/sendToTabAllFrames";

// MAIN world 레코더 버퍼 제어 메시지 senders. editor-store가 clear를 직접 호출하므로
// useEditorStore에 의존하는 picker-control과 분리해 순환 import를 끊는다.
export async function clearNetworkRecorder(tabId: number): Promise<void> {
  await sendToTabAllFrames(tabId, { type: "networkRecorder.clear" });
}

export async function clearConsoleRecorder(tabId: number): Promise<void> {
  await sendToTabAllFrames(tabId, { type: "consoleRecorder.clear" });
}

// 네비게이션 경계 clear(logClear)만 resupplyEntryNav를 켠다 — 세션 준비 clear(prepareRecorders)가
// 켜면 재arm이 유령 진입 항목을 만든다. network/console엔 이 축이 없다(진입 항목이 액션 전용).
export async function clearActionRecorder(
  tabId: number,
  opts?: { resupplyEntryNav?: boolean },
): Promise<void> {
  await sendToTabAllFrames(tabId, { type: "actionRecorder.clear", resupplyEntryNav: opts?.resupplyEntryNav });
}
