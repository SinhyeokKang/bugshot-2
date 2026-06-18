import { useEffect, useRef } from "react";

const SYNC_INTERVAL = 1500;

// 탭이 활성인 동안 1.5s 간격으로 레코더를 동기화. (Console/Network SubTab 공용)
export function useRecorderSyncInterval(
  active: boolean,
  tabId: number | null | undefined,
  sync: (tabId: number) => Promise<unknown>,
) {
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    if (!active || tabIdRef.current == null) return;
    syncRef.current(tabIdRef.current).catch(() => {});
    const id = setInterval(() => {
      if (tabIdRef.current != null) {
        syncRef.current(tabIdRef.current).catch(() => {});
      }
    }, SYNC_INTERVAL);
    return () => clearInterval(id);
  }, [active]);
}
