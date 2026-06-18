import { ListRestart, SquarePen } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useRecorderSyncInterval } from "@/sidepanel/hooks/useRecorderSyncInterval";
import { syncConsoleRecorder } from "@/sidepanel/picker-control";
import { consoleLogPersist } from "@/sidepanel/hooks/usePickerMessages";
import { PageShell, PageFooter } from "@/sidepanel/components/Section";
import { ConsoleLogContent } from "@/sidepanel/components/ConsoleLogContent";

export function ConsoleSubTab({ active, onStartFreeform }: { active: boolean; onStartFreeform: () => void }) {
  const t = useT();
  const tabId = useBoundTabId();
  const consoleLog = useEditorStore((s) => s.consoleLog);

  useRecorderSyncInterval(active, tabId, syncConsoleRecorder);

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
            onClick={() => {
              // clear가 IDB pending을 delete하므로 대기 중 throttle write를 먼저 폐기해
              // delete 이후 stale 버퍼가 IDB에 부활하는 걸 막는다 (logClear 메시지 경로와 대칭).
              consoleLogPersist.discard();
              useEditorStore.getState().clearConsoleLog(tabId ?? null);
            }}
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
