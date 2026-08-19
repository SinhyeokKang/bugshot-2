import { sendToTabAllFrames } from "@/sidepanel/lib/sendToTabAllFrames";

// picker-control에서 떼어낸 leaf. issues-store가 clearPicker를 부르는데, picker-control을
// 끌면 사이드패널 컴포넌트 그래프가 store 번들로 딸려온다.
// tabFrameTokens를 함께 내리는 게 핵심이다 — clearPicker만 옮기면 Map이 둘로 갈려
// clear 후에도 토큰이 살아 restartPickerInFrame이 유령 blocker를 재주입한다.

// 전 프레임 broadcast는 lib의 정본을 쓴다 — 같은 의미의 헬퍼를 여기 또 두면 다섯 번째 사본이다.
export { sendToTabAllFrames as sendAll };

// picking 세션의 PRESENT 등록 token — 커밋된 iframe에 picker.start를 재전송할 때 같은
// token을 실어야 top registry 검증을 통과한다(tabSentinels와 동형의 탭별 보유).
export const tabFrameTokens = new Map<number, string>();

export async function clearPicker(tabId: number): Promise<void> {
  tabFrameTokens.delete(tabId);
  await sendToTabAllFrames(tabId, { type: "picker.clear" });
}
