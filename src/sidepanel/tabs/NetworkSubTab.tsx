import { useEffect, useRef } from "react";
import { PenLine } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { syncNetworkRecorder } from "../picker-control";
import { PageShell, PageFooter } from "../components/Section";
import { NetworkLogContent } from "../components/NetworkLogContent";

const SYNC_INTERVAL = 1500;

export function NetworkSubTab({ active, onStartFreeform }: { active: boolean; onStartFreeform: () => void }) {
  const t = useT();
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
    <PageShell>
      <NetworkLogContent flush requests={networkLog?.requests ?? []} />
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
