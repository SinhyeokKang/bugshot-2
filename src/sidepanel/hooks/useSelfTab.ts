import { useEffect, useState } from "react";
import { getSelfTab } from "@/sidepanel/tab-mode";

/** undefined = 확인 중, null = 사이드패널, {id} = 탭 모드. */
export function useSelfTab(): { id: number } | null | undefined {
  const [self, setSelf] = useState<{ id: number } | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void getSelfTab().then((s) => {
      if (!cancelled) setSelf(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return self;
}

// 탭 모드 전용 UI의 게이트 — 확인 중과 사이드패널은 둘 다 false라 사이드패널 렌더 0을 지킨다.
export function useIsTabMode(): boolean {
  return useSelfTab() != null;
}
