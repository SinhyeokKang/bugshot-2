import { useEffect, useRef } from "react";
import { ListRestart, SquarePen } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { syncConsoleRecorder } from "@/sidepanel/picker-control";
import { PageShell, PageFooter } from "@/sidepanel/components/Section";
import { ConsoleLogContent } from "@/sidepanel/components/ConsoleLogContent";

const SYNC_INTERVAL = 1500;

export function ConsoleSubTab({ active, onStartFreeform }: { active: boolean; onStartFreeform: () => void }) {
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

  return (
    <PageShell>
      <ConsoleLogContent
        flush
        entries={consoleLog?.entries ?? []}
      />
      <PageFooter>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={tabId == null || (consoleLog?.entries.length ?? 0) === 0}
            onClick={() => useEditorStore.getState().clearConsoleLog(tabId ?? null)}
            data-testid="console-clear"
          >
            <ListRestart />
            {t("consoleLog.clear")}
          </Button>
          <Button variant="outline" onClick={onStartFreeform}>
            <SquarePen />
            {t("issue.startDraft")}
          </Button>
        </div>
      </PageFooter>
    </PageShell>
  );
}
