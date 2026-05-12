import { useEffect, useRef } from "react";
import { Globe } from "lucide-react";
import { useT } from "@/i18n";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { syncNetworkRecorder } from "../picker-control";
import { NetworkLogContent } from "../components/NetworkLogContent";

const SYNC_INTERVAL = 1500;

export function NetworkSubTab({ active }: { active: boolean }) {
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

  if (!networkLog || networkLog.captured === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <div className="rounded-full bg-muted p-3">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
        <span className="text-sm text-muted-foreground">{t("debug.network.empty")}</span>
      </div>
    );
  }

  return <NetworkLogContent requests={networkLog.requests} />;
}
