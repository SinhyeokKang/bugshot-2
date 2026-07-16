import { useState } from "react";
import { useT } from "@/i18n";
import type { NetworkRequest } from "@/types/network";
import type { ConsoleEntry } from "@/types/console";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NetworkLogContent } from "./NetworkLogContent";
import { ConsoleLogContent } from "./ConsoleLogContent";
import { serializeNetworkRequest, serializeConsoleEntry } from "@/sidepanel/lib/logToCodeBlock";

type LogTab = "network" | "console";

interface LogInsertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: NetworkRequest[];
  entries: ConsoleEntry[];
  startedAt?: number;
  syncBaseMs?: number; // 상대 시각 0점(영상 모드면 videoStartedAt)
  onInsert: (text: string, language?: string) => void;
}

export function LogInsertDialog({
  open,
  onOpenChange,
  requests,
  entries,
  startedAt,
  syncBaseMs,
  onInsert,
}: LogInsertDialogProps) {
  const t = useT();
  const [tab, setTab] = useState<LogTab>("network");
  const [activeNetworkId, setActiveNetworkId] = useState<string | null>(null);
  const [activeConsoleId, setActiveConsoleId] = useState<string | null>(null);

  const selectedRequest = requests.find((r) => r.id === activeNetworkId) ?? null;
  const selectedEntry = entries.find((e) => e.id === activeConsoleId) ?? null;
  const selected = tab === "network" ? selectedRequest : selectedEntry;

  const handleInsert = () => {
    const block =
      tab === "network"
        ? selectedRequest && serializeNetworkRequest(selectedRequest)
        : selectedEntry && serializeConsoleEntry(selectedEntry);
    if (!block) return;
    onInsert(block.text, block.language);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="log-insert-dialog"
        className="w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{t("logInsert.dialog.title")}</DialogTitle>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as LogTab)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList className="self-start">
            <TabsTrigger value="network" data-testid="log-insert-tab-network">
              {t("debug.tab.network")}
            </TabsTrigger>
            <TabsTrigger value="console" data-testid="log-insert-tab-console">
              {t("debug.tab.console")}
            </TabsTrigger>
          </TabsList>

          {/* forceMount — 언마운트되면 NetworkLogContent 내부 선택·검색·필터가 탭 왕복마다 날아간다. */}
          <TabsContent
            forceMount
            value="network"
            className="mt-0 flex min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <NetworkLogContent
              requests={requests}
              syncBaseMs={syncBaseMs}
              onActiveChange={setActiveNetworkId}
            />
          </TabsContent>
          <TabsContent
            forceMount
            value="console"
            className="mt-0 flex min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <ConsoleLogContent
              entries={entries}
              startedAt={startedAt}
              syncBaseMs={syncBaseMs}
              selectable
              selectedId={activeConsoleId}
              onActiveChange={setActiveConsoleId}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button disabled={!selected} onClick={handleInsert} data-testid="log-insert-confirm">
            {t("logInsert.insert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
