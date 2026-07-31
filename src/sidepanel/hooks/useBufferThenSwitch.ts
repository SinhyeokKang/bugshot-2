import { toast } from "sonner";
import { t } from "@/i18n";
import { useEditorStore } from "@/store/editor-store";
import { hasStyleChange } from "@/sidepanel/lib/hasStyleChange";
import { captureElementSnapshot } from "@/sidepanel/capture";
import { sameCaptureBasis } from "@/sidepanel/lib/capture-basis";
import { isCssDraftUnapplied } from "@/sidepanel/tabs/styleEditor/cssDraftStatus";

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
      const { selection, styleEdits, bufferCurrentElement, captureContext } =
        useEditorStore.getState();
      // 미적용 draft로 전환하면 그 편집이 조용히 사라진다. 다만 막기만 하면 버튼이
      // 아무 반응 없이 죽어 "안 눌린다"로 보이므로(DESIGN.md §14 — 잠금엔 이유를 함께
      // 준다) 사유를 토스트로 알린다. [다음] 버튼은 같은 사유를 툴팁으로 노출한다.
      if (
        selection &&
        isCssDraftUnapplied(
          styleEdits.cssText,
          selection.specifiedStyles,
          styleEdits.inlineStyle,
        )
      ) {
        toast.error(t("editor.cssDraftUnapplied"));
        return;
      }
      if (selection && hasStyleChange(selection, styleEdits)) {
        const after = await captureElementSnapshot(tabId, {
          frameId: selection.frameId ?? 0,
          context: captureContext ?? undefined,
        });
        // in-flight였던 before가 이 창 안에 착지하면 after는 낡은 기준으로 찍힌 것이다.
        // 짝이 갈린 이미지를 남기지 않도록 after를 버리고, 버퍼는 store의 (before, 기준)
        // 짝을 그대로 쓴다 — 잠금은 [다음] 버튼 한 문에만 있어 이 경로를 못 막는다.
        const landed = useEditorStore.getState().captureContext;
        const stale = !sameCaptureBasis(captureContext, landed);
        bufferCurrentElement(
          stale ? null : after?.image ?? null,
          landed ?? undefined,
        );
      }
      await switchAction();
    } finally {
      switchBusy = false;
    }
  };
}
