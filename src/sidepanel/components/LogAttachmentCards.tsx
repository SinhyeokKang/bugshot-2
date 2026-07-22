import { ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { logCardTypeCounts } from "@/sidepanel/components/logCardTypeCounts";

interface LogAttachmentCardsProps {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog?: ActionLog | null;
  logsAttach: boolean;
  onToggle?: (on: boolean) => void;
  onClick: () => void;
  readOnly?: boolean;
}

export function LogAttachmentCards({
  networkLog,
  consoleLog,
  actionLog,
  logsAttach,
  onToggle,
  onClick,
  readOnly,
}: LogAttachmentCardsProps) {
  const t = useT();
  const hasNetwork = networkLog !== null && networkLog.captured > 0;
  const hasConsole = consoleLog !== null && consoleLog.captured > 0;
  const hasAction = !!actionLog && actionLog.captured > 0;
  if (!hasNetwork && !hasConsole && !hasAction) return null;

  const description = logCardTypeCounts(
    { networkLog, consoleLog, actionLog: actionLog ?? null },
    t,
  );

  return (
    <Card
      data-testid="log-attachment-card"
      role="button"
      tabIndex={0}
      className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-accent/50"
      onClick={onClick}
      onKeyDown={(e) => {
        // 카드 자체 포커스일 때만 — Switch(중첩 button) 키 활성화가 버블링해 다이얼로그를 열지 않게.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="shrink-0">
        <ScrollText className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{t("logCard.title")}</span>
        <span className="truncate text-sm text-muted-foreground">{description}</span>
      </div>
      {!readOnly && (
        <Switch
          checked={logsAttach}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </Card>
  );
}
