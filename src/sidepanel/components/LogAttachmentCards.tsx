import { ArrowLeftRight, MousePointerClick, Terminal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useT, type TranslationFn } from "@/i18n";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";

interface LogAttachmentCardsProps {
  networkLog: NetworkLog | null;
  networkLogAttach: boolean;
  onNetworkLogToggle: (on: boolean) => void;
  onNetworkLogClick: () => void;
  consoleLog: ConsoleLog | null;
  consoleLogAttach: boolean;
  onConsoleLogToggle: (on: boolean) => void;
  onConsoleLogClick: () => void;
  actionLog?: ActionLog | null;
  actionLogAttach?: boolean;
  onActionLogToggle?: (on: boolean) => void;
  onActionLogClick?: () => void;
  readOnly?: boolean;
}

export function LogAttachmentCards({
  networkLog,
  networkLogAttach,
  onNetworkLogToggle,
  onNetworkLogClick,
  consoleLog,
  consoleLogAttach,
  onConsoleLogToggle,
  onConsoleLogClick,
  actionLog,
  actionLogAttach,
  onActionLogToggle,
  onActionLogClick,
  readOnly,
}: LogAttachmentCardsProps) {
  const t = useT();
  const showNetwork = networkLog !== null && networkLog.captured > 0;
  const showConsole = consoleLog !== null && consoleLog.captured > 0;
  const showAction = !!actionLog && actionLog.captured > 0;
  const count = [showNetwork, showConsole, showAction].filter(Boolean).length;
  if (count === 0) return null;

  // 좁은 사이드패널·다이얼로그 모두 대응하려 컨테이너 쿼리 사용. 3개일 때만 너비에 따라
  // 1열↔3열로 끊고(중간 2+1 없음), 1~2개는 기존대로.
  const cols =
    count === 3 ? "grid-cols-1 @[35rem]:grid-cols-3" : count === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <div className="@container">
      <div className={`grid gap-2 ${cols}`}>
        {showNetwork && (
          <LogCard
            testId="network-log-card"
            icon={<ArrowLeftRight className="h-4 w-4" />}
            title={t("networkLog.dialog.title")}
            description={networkDescription(networkLog, t)}
            attach={networkLogAttach}
            disabled={networkLog.captured === 0}
            onToggle={onNetworkLogToggle}
            onClick={onNetworkLogClick}
            readOnly={readOnly}
          />
        )}
        {showConsole && (
          <LogCard
            testId="console-log-card"
            icon={<Terminal className="h-4 w-4" />}
            title={t("consoleLog.dialog.title")}
            description={consoleDescription(consoleLog, t)}
            attach={consoleLogAttach}
            disabled={consoleLog.captured === 0}
            onToggle={onConsoleLogToggle}
            onClick={onConsoleLogClick}
            readOnly={readOnly}
          />
        )}
        {showAction && (
          <LogCard
            testId="action-log-card"
            icon={<MousePointerClick className="h-4 w-4" />}
            title={t("actionLog.dialog.title")}
            description={t("actionLog.cardDescription", { captured: actionLog.captured })}
            attach={!!actionLogAttach}
            disabled={actionLog.captured === 0}
            onToggle={onActionLogToggle ?? (() => {})}
            onClick={onActionLogClick ?? (() => {})}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}

function LogCard({
  testId,
  icon,
  title,
  description,
  attach,
  disabled,
  onToggle,
  onClick,
  readOnly,
}: {
  testId?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  attach: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
  onClick: () => void;
  readOnly?: boolean;
}) {
  return (
    <Card
      data-testid={testId}
      className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-accent/50 ${disabled ? "opacity-50" : ""}`}
      onClick={() => { if (!disabled) onClick(); }}
    >
      <div className="shrink-0">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-sm text-muted-foreground">{description}</span>
      </div>
      {!readOnly && (
        <Switch
          checked={attach}
          onCheckedChange={onToggle}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </Card>
  );
}

function networkDescription(log: NetworkLog, t: TranslationFn): string {
  const errors = log.requests.filter((r) => r.status >= 400).length;
  return t("logCard.description", { captured: log.captured, errors });
}

function consoleDescription(log: ConsoleLog, t: TranslationFn): string {
  const errors = log.entries.filter((e) => e.level === "error").length;
  return t("logCard.description", { captured: log.captured, errors });
}
