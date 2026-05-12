import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import { useT } from "@/i18n";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { syncConsoleRecorder } from "../picker-control";
import { ConsoleLogContent } from "../components/ConsoleLogContent";

const SYNC_INTERVAL = 1500;

export function ConsoleSubTab({ active }: { active: boolean }) {
  const t = useT();
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

  if (!consoleLog || consoleLog.captured === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <div className="rounded-full bg-muted p-3">
          <Terminal className="h-6 w-6 text-muted-foreground" />
        </div>
        <span className="text-sm text-muted-foreground">{t("debug.console.empty")}</span>
      </div>
    );
  }

  return <ConsoleLogContent entries={consoleLog.entries} startedAt={consoleLog.startedAt} />;
}
