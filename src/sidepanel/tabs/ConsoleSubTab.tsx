import { useEffect, useRef } from "react";
import { PenLine } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { syncConsoleRecorder } from "../picker-control";
import { PageShell, PageFooter } from "../components/Section";
import { ConsoleLogContent } from "../components/ConsoleLogContent";

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
        startedAt={consoleLog?.startedAt ?? Date.now()}
      />
      <PageFooter>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onStartFreeform}>
            <PenLine />
            {t("issue.mode.freeform")}
          </Button>
        </div>
      </PageFooter>
    </PageShell>
  );
}
