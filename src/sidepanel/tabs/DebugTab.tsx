import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, SquarePen, Terminal } from "lucide-react";
import { useT } from "@/i18n";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { Badge } from "@/components/ui/badge";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useCaptureShortcuts } from "@/sidepanel/hooks/useCaptureShortcuts";
import { startFreeformDraft, syncNetworkRecorder, syncConsoleRecorder, syncActionRecorder } from "@/sidepanel/picker-control";
import { IssueTab } from "./IssueTab";
import { ConsoleSubTab } from "./ConsoleSubTab";
import { NetworkSubTab } from "./NetworkSubTab";

type DebugSubTab = "issue" | "console" | "network";

export function DebugTab({ activeMainTab }: { activeMainTab: string }) {
  const t = useT();
  const [sub, setSub] = useState<DebugSubTab>("issue");
  const tabId = useBoundTabId();
  const phase = useEditorStore((s) => s.phase);
  const consoleCount = useEditorStore((s) => s.consoleLog?.entries.length ?? 0);
  const networkCount = useEditorStore((s) => s.networkLog?.requests.length ?? 0);
  // 이슈 작성 플로우(styling~done)에선 하위 탭 바를 통째로 숨긴다 — 로그 서브탭은 어차피
  // 진입 불가(recording 버퍼/동결 로그를 Clear로 깨지 않도록)고, 작성 화면에 집중시킨다.
  // 앱 전역 탭은 그대로 유지. 작성 진입 경로가 모두 issue 서브탭이라 sub는 이때 항상 "issue".
  const inIssueFlow =
    phase === "styling" ||
    phase === "recording" ||
    phase === "drafting" ||
    phase === "previewing" ||
    phase === "done";

  useCaptureShortcuts({ active: activeMainTab === "debug" && sub === "issue", tabId: tabId ?? null });

  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  useEffect(() => {
    if (activeMainTab !== "debug" || sub === "console" || sub === "network") return;
    if (tabIdRef.current == null) return;
    const sync = () => {
      if (tabIdRef.current == null) return;
      syncNetworkRecorder(tabIdRef.current).catch(() => {});
      syncConsoleRecorder(tabIdRef.current).catch(() => {});
      syncActionRecorder(tabIdRef.current).catch(() => {});
    };
    sync();
    const id = setInterval(sync, 1500);
    return () => clearInterval(id);
  }, [activeMainTab, sub]);

  const handleStartFreeform = useCallback(() => {
    if (tabId == null) return;
    setSub("issue");
    void startFreeformDraft(tabId);
  }, [tabId]);

  return (
    <Tabs
      value={sub}
      onValueChange={(v) => setSub(v as DebugSubTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      {!inIssueFlow && (
        <div className="shrink-0 border-b border-border px-4 py-4">
          <CollapsingTabsList className="grid h-9 w-full grid-cols-3">
            <TabsTrigger value="issue" className="min-w-0 gap-1.5">
              <SquarePen className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.issue")}</TabLabel>
            </TabsTrigger>
            <TabsTrigger value="console" className="min-w-0 gap-1.5" data-testid="subtab-console">
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.console")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {consoleCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="network" className="min-w-0 gap-1.5" data-testid="subtab-network">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.network")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {networkCount}
              </Badge>
            </TabsTrigger>
          </CollapsingTabsList>
        </div>
      )}

      <TabsContent
        value="issue"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <IssueTab />
      </TabsContent>

      <TabsContent
        value="console"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <ConsoleSubTab active={sub === "console"} onStartFreeform={handleStartFreeform} />
      </TabsContent>

      <TabsContent
        value="network"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <NetworkSubTab active={sub === "network"} onStartFreeform={handleStartFreeform} />
      </TabsContent>
    </Tabs>
  );
}
