import { ListRestart, SquarePen } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useRecorderSyncInterval } from "@/sidepanel/hooks/useRecorderSyncInterval";
import { syncNetworkRecorder } from "@/sidepanel/picker-control";
import { networkLogPersist } from "@/sidepanel/hooks/usePickerMessages";
import { PageShell, PageFooter } from "@/sidepanel/components/Section";
import { NetworkLogContent } from "@/sidepanel/components/NetworkLogContent";

export function NetworkSubTab({ active, onStartFreeform }: { active: boolean; onStartFreeform: () => void }) {
  const t = useT();
  const tabId = useBoundTabId();
  const networkLog = useEditorStore((s) => s.networkLog);

  useRecorderSyncInterval(active, tabId, syncNetworkRecorder);

  return (
    <PageShell>
      <NetworkLogContent flush requests={networkLog?.requests ?? []} />
      <PageFooter>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={tabId == null || (networkLog?.requests.length ?? 0) === 0}
            onClick={() => {
              // clear가 IDB pending을 delete하므로 대기 중 throttle write를 먼저 폐기해
              // delete 이후 stale 버퍼가 IDB에 부활하는 걸 막는다 (logClear 메시지 경로와 대칭).
              networkLogPersist.discard();
              useEditorStore.getState().clearNetworkLog(tabId ?? null);
            }}
            data-testid="network-clear"
          >
            <ListRestart />
            {t("networkLog.clear")}
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
