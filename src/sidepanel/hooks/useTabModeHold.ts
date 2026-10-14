import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { targetHoldFromState } from "@/sidepanel/lib/tab-mode";
import { getSelfTab, holdTarget } from "@/sidepanel/tab-mode";

type StateReason = "picking" | "inline";

// 탭 모드에서 picking·인라인 영역 대기 동안 대상 탭을 앞에 둔다. 사이드패널은 구독하지 않는다.
export function useTabModeHold(tabId: number | null): void {
  useEffect(() => {
    if (tabId == null) return;
    let disposed = false;
    let unsub = () => {};
    const releases: Partial<Record<StateReason, Promise<() => Promise<void>>>> = {};

    const sync = () => {
      const s = useEditorStore.getState();
      const want = targetHoldFromState({ phase: s.phase, inline: s.inlineCaptureTarget !== null });
      for (const reason of ["picking", "inline"] as const) {
        if (want[reason] && !releases[reason]) {
          releases[reason] = holdTarget(tabId, reason);
        } else if (!want[reason] && releases[reason]) {
          void releases[reason].then((release) => release());
          delete releases[reason];
        }
      }
    };

    void getSelfTab().then((self) => {
      if (disposed || !self) return;
      // picking 해제는 .then으로 한 틱 뒤에 돈다 — 요소 선택과 같은 태스크에서 잡히는 before 캡처 hold가 먼저 count를 올린다.
      unsub = useEditorStore.subscribe(sync);
      sync();
    });

    return () => {
      disposed = true;
      unsub();
      for (const reason of ["picking", "inline"] as const) {
        void releases[reason]?.then((release) => release());
      }
    };
  }, [tabId]);
}
