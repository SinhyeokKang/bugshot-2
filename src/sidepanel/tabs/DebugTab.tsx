import { useCallback, useState } from "react";
import { ArrowLeftRight, SquarePen, Terminal } from "lucide-react";
import { useT } from "@/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useCaptureShortcuts } from "@/sidepanel/hooks/useCaptureShortcuts";
import { startFreeformDraft } from "@/sidepanel/picker-control";
import { IssueTab } from "./IssueTab";
import { ConsoleSubTab } from "./ConsoleSubTab";
import { NetworkSubTab } from "./NetworkSubTab";

type DebugSubTab = "issue" | "console" | "network";

export function DebugTab({ activeMainTab }: { activeMainTab: string }) {
  const t = useT();
  const [sub, setSub] = useState<DebugSubTab>("issue");
  const tabId = useBoundTabId();
  const phase = useEditorStore((s) => s.phase);
  const [logUnavailableOpen, setLogUnavailableOpen] = useState(false);

  useCaptureShortcuts({ active: activeMainTab === "debug" && sub === "issue", tabId: tabId ?? null });

  const handleStartFreeform = useCallback(() => {
    if (tabId == null) return;
    setSub("issue");
    void startFreeformDraft(tabId);
  }, [tabId]);

  return (
    <Tabs
      value={sub}
      onValueChange={(v) => {
        const next = v as DebugSubTab;
        if (
          (next === "console" || next === "network") &&
          (phase === "drafting" || phase === "previewing")
        ) {
          setLogUnavailableOpen(true);
          return;
        }
        setSub(next);
      }}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <TabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="issue" className="gap-1.5">
            <SquarePen className="h-3.5 w-3.5" />
            {t("debug.tab.issue")}
          </TabsTrigger>
          <TabsTrigger value="console" className="gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            {t("debug.tab.console")}
          </TabsTrigger>
          <TabsTrigger value="network" className="gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {t("debug.tab.network")}
          </TabsTrigger>
        </TabsList>
      </div>

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

      <AlertDialog open={logUnavailableOpen} onOpenChange={setLogUnavailableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("debug.logUnavailable.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("debug.logUnavailable.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setLogUnavailableOpen(false)}>
              {t("debug.logUnavailable.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
