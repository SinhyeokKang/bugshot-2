import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
  const showNetwork = networkLog !== null;
  const showConsole = consoleLog !== null;
  if (!showNetwork && !showConsole) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {showNetwork && (
        <LogCard
          title="network-log.har"
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
          title="console-log.json"
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
  title,
  description,
  attach,
  disabled,
  onToggle,
  onClick,
  readOnly,
}: {
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
      className={`flex cursor-pointer flex-col gap-1.5 p-3 transition-colors hover:bg-accent/50 ${disabled ? "opacity-50" : ""}`}
      onClick={() => { if (!disabled) onClick(); }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium font-mono">{title}</span>
        {!readOnly && (
          <Switch
            checked={attach}
            onCheckedChange={onToggle}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            className="scale-75"
          />
        )}
      </div>
      <span className="text-[11px] leading-tight text-muted-foreground">{description}</span>
    </Card>
  );
}

function networkDescription(log: NetworkLog, t: ReturnType<typeof useT>): string {
  const errorCount = log.requests.filter((r) => r.status >= 400).length;
  const parts: string[] = [];
  parts.push(t("networkLog.counter.captured").replace("{n}", String(log.captured)));
  if (errorCount > 0) {
    parts.push(`${errorCount} errors`);
  }
  return parts.join(" · ");
}

function consoleDescription(log: ConsoleLog, t: ReturnType<typeof useT>): string {
  const errorCount = log.entries.filter((e) => e.level === "error").length;
  const warnCount = log.entries.filter((e) => e.level === "warn").length;
  const parts: string[] = [];
  parts.push(t("consoleLog.counter.captured").replace("{n}", String(log.captured)));
  if (errorCount > 0 || warnCount > 0) {
    const counts: string[] = [];
    if (errorCount > 0) counts.push(`${errorCount} errors`);
    if (warnCount > 0) counts.push(`${warnCount} warns`);
    parts.push(counts.join(", "));
  }
  return parts.join(" · ");
}
