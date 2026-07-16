import { useEffect, useState } from "react";
import { ArrowLeftRight, Terminal } from "lucide-react";
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
import { Tabs, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { Badge } from "@/components/ui/badge";
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

  // 열 때마다 선택을 비운다 — 네트워크는 content 재마운트로 어차피 리셋되므로,
  // 콘솔만 이전 선택이 살아남으면 "삽입 전 확인" 전제가 한쪽만 깨진다.
  useEffect(() => {
    if (!open) return;
    setActiveNetworkId(null);
    setActiveConsoleId(null);
    setTab(requests.length === 0 && entries.length > 0 ? "console" : "network");
  }, [open, requests.length, entries.length]);

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
          {/* 디버그 하위탭과 같은 관례 — 콘솔→네트워크 순서·아이콘·개수 배지·grid flex 폭. */}
          <CollapsingTabsList className="grid h-9 w-full shrink-0 grid-cols-2">
            <TabsTrigger value="console" className="min-w-0 gap-1.5" data-testid="log-insert-tab-console">
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.console")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {entries.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="network" className="min-w-0 gap-1.5" data-testid="log-insert-tab-network">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.network")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {requests.length}
              </Badge>
            </TabsTrigger>
          </CollapsingTabsList>

          {/* forceMount — 언마운트되면 NetworkLogContent 내부 선택·검색·필터가 탭 왕복마다 날아간다. */}
          <TabsContent
            forceMount
            value="console"
            className="mt-0 flex min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <ConsoleLogContent
              entries={entries}
              startedAt={startedAt}
              syncBaseMs={syncBaseMs}
              selectedId={activeConsoleId}
              onActiveChange={setActiveConsoleId}
            />
          </TabsContent>
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
