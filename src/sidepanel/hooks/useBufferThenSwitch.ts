import { useEditorStore } from "@/store/editor-store";
import { hasStyleChange } from "@/sidepanel/lib/hasStyleChange";
import { captureElementSnapshot } from "@/sidepanel/capture";

// 전환 진입점(RepickButton·DomNavButton)은 각기 다른 컴포넌트로 마운트되므로, 캡처 await 창
// 동안 서로 다른 버튼의 중복 클릭까지 막으려면 busy 가드를 모듈 전역으로 공유해야 한다.
let switchBusy = false;

// element 전환 진입점 공유 로직: 현재 element에 diff가 있으면 after 스냅샷을 캡처해 버퍼에
// 적재한 뒤 전환 액션을 실행한다. diff 없으면 전환만(잔여 없음). 캡처 중 중복 클릭 방지.
export function useBufferThenSwitch(): (
  tabId: number,
  switchAction: () => void | Promise<void>,
) => Promise<void> {
  return async (tabId, switchAction) => {
    if (switchBusy) return;
    switchBusy = true;
    try {
      const { selection, styleEdits, bufferCurrentElement } =
        useEditorStore.getState();
      if (selection && hasStyleChange(selection, styleEdits)) {
        const after = await captureElementSnapshot(tabId, {
          frameId: selection.frameId ?? 0,
        });
        bufferCurrentElement(after);
      }
      await switchAction();
    } finally {
      switchBusy = false;
    }
  };
}
