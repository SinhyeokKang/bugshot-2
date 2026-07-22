import { useEffect, useState } from "react";
import { ArrowLeftRight, MousePointerClick, Terminal } from "lucide-react";
import { useT } from "@/i18n";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
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
import { ActionLogContent } from "./ActionLogContent";

type LogTab = "console" | "network" | "action";

interface LogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog?: ActionLog | null;
  logsAttach?: boolean;
  onToggleAttach?: (attach: boolean) => void; // 미공급 = 읽기 전용(첨부 버튼 숨김)
  syncBaseMs?: number; // 상대 시각 0점(영상 모드면 videoStartedAt)
}

export function LogPreviewDialog({
  open,
  onOpenChange,
  networkLog,
  consoleLog,
  actionLog,
  logsAttach,
  onToggleAttach,
  syncBaseMs,
}: LogPreviewDialogProps) {
  const t = useT();

  // 탭셋은 항상 console/network/action 고정(LogInsertDialog와 동일 — 0건은 숨기지 않고 EmptyCase).
  // 기본 활성 탭만 캡처된 탭 중 console → network → action 순 첫 번째로 연다(log-viewer와 동일).
  const defaultTab: LogTab =
    consoleLog && consoleLog.entries.length > 0
      ? "console"
      : networkLog && networkLog.requests.length > 0
        ? "network"
        : "action";
  const [tab, setTab] = useState<LogTab>(defaultTab);
  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="log-preview-dialog"
        className="w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">logs.html</DialogTitle>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as LogTab)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <CollapsingTabsList className="grid h-9 w-full shrink-0 grid-cols-3">
            <TabsTrigger value="console" className="min-w-0 gap-1.5" data-testid="log-preview-tab-console">
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.console")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {consoleLog?.entries.length ?? 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="network" className="min-w-0 gap-1.5" data-testid="log-preview-tab-network">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.network")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {networkLog?.requests.length ?? 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="action" className="min-w-0 gap-1.5" data-testid="log-preview-tab-action">
              <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.action")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {actionLog?.entries.length ?? 0}
              </Badge>
            </TabsTrigger>
          </CollapsingTabsList>

          {/* forceMount — 언마운트되면 Content 내부 검색·필터·스크롤 위치가 탭 왕복마다 날아간다. */}
          <TabsContent
            forceMount
            value="console"
            className="mt-0 flex min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <ConsoleLogContent
              entries={consoleLog?.entries ?? []}
              startedAt={consoleLog?.startedAt}
              syncBaseMs={syncBaseMs}
            />
          </TabsContent>
          <TabsContent
            forceMount
            value="network"
            className="mt-0 flex min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <NetworkLogContent requests={networkLog?.requests ?? []} syncBaseMs={syncBaseMs} />
          </TabsContent>
          <TabsContent
            forceMount
            value="action"
            className="mt-0 flex min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <ActionLogContent
              entries={actionLog?.entries ?? []}
              startedAt={actionLog?.startedAt}
              syncBaseMs={syncBaseMs}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          {onToggleAttach && (
            <Button
              data-testid="log-preview-toggle-attach"
              onClick={() => { onToggleAttach(!logsAttach); onOpenChange(false); }}
            >
              {logsAttach ? t("common.detach") : t("common.attach")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
