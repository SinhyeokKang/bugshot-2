import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { syncNetworkRecorder } from "../picker-control";
import { NetworkLogContent } from "../components/NetworkLogContent";

const SYNC_INTERVAL = 1500;

export function NetworkSubTab({ active }: { active: boolean }) {
  const tabId = useBoundTabId();
  const networkLog = useEditorStore((s) => s.networkLog);

  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  useEffect(() => {
    if (!active || tabIdRef.current == null) return;
    syncNetworkRecorder(tabIdRef.current).catch(() => {});
    const id = setInterval(() => {
      if (tabIdRef.current != null) {
        syncNetworkRecorder(tabIdRef.current).catch(() => {});
      }
    }, SYNC_INTERVAL);
    return () => clearInterval(id);
  }, [active]);

  return (
    <NetworkLogContent flush requests={networkLog?.requests ?? []} />
  );
}
