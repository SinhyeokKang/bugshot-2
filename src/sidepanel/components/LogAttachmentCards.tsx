import { ArrowLeftRight, Terminal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useT, type TranslationFn } from "@/i18n";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";

interface LogAttachmentCardsProps {
  networkLog: NetworkLog | null;
  networkLogAttach: boolean;
  onNetworkLogToggle: (on: boolean) => void;
  onNetworkLogClick: () => void;
  consoleLog: ConsoleLog | null;
  consoleLogAttach: boolean;
  onConsoleLogToggle: (on: boolean) => void;
  onConsoleLogClick: () => void;
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
  readOnly,
}: LogAttachmentCardsProps) {
  const t = useT();
  const showNetwork = networkLog !== null && networkLog.captured > 0;
  const showConsole = consoleLog !== null && consoleLog.captured > 0;
  if (!showNetwork && !showConsole) return null;

  return (
    <div className={`grid gap-2 ${showNetwork && showConsole ? "grid-cols-2" : "grid-cols-1"}`}>
      {showNetwork && (
        <LogCard
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
    </div>
  );
}

function LogCard({
  icon,
  title,
  description,
  attach,
  disabled,
  onToggle,
  onClick,
  readOnly,
}: {
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
      className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-accent/50 ${disabled ? "opacity-50" : ""}`}
      onClick={() => { if (!disabled) onClick(); }}
    >
      <div className="shrink-0">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
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
