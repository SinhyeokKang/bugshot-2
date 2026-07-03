import { useRef } from "react";
import { useEditorStore } from "@/store/editor-store";
import { hasStyleChange } from "@/sidepanel/lib/hasStyleChange";
import { captureElementSnapshot } from "@/sidepanel/capture";

// element 전환 진입점(RepickButton·DomNavButton) 공유 로직: 현재 element에 diff가 있으면
// after 스냅샷을 캡처해 버퍼에 적재한 뒤 전환 액션을 실행한다. diff 없으면 전환만(잔여 없음).
// 캡처 중 중복 클릭 방지.
export function useBufferThenSwitch(): (
  tabId: number,
  switchAction: () => void | Promise<void>,
) => Promise<void> {
  const busyRef = useRef(false);
  return async (tabId, switchAction) => {
    if (busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
    }
  };
}
