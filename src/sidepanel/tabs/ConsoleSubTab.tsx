import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { syncConsoleRecorder } from "../picker-control";
import { ConsoleLogContent } from "../components/ConsoleLogContent";

const SYNC_INTERVAL = 1500;

export function ConsoleSubTab({ active }: { active: boolean }) {
  const tabId = useBoundTabId();
  const consoleLog = useEditorStore((s) => s.consoleLog);

  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  useEffect(() => {
    if (!active || tabIdRef.current == null) return;
    syncConsoleRecorder(tabIdRef.current).catch(() => {});
    const id = setInterval(() => {
      if (tabIdRef.current != null) {
        syncConsoleRecorder(tabIdRef.current).catch(() => {});
      }
    }, SYNC_INTERVAL);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <ConsoleLogContent
        entries={consoleLog?.entries ?? []}
        startedAt={consoleLog?.startedAt ?? Date.now()}
      />
    </div>
  );
}
