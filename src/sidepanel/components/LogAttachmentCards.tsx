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
  const showNetwork = networkLog !== null;
  const showConsole = consoleLog !== null;
  if (!showNetwork && !showConsole) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {showNetwork && (
        <LogCard
          title="network-log"
          description={networkDescription(networkLog)}
          attach={networkLogAttach}
          disabled={networkLog.captured === 0}
          onToggle={onNetworkLogToggle}
          onClick={onNetworkLogClick}
          readOnly={readOnly}
        />
      )}
      {showConsole && (
        <LogCard
          title="console-log"
          description={consoleDescription(consoleLog)}
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
      className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-accent/50 ${disabled ? "opacity-50" : ""}`}
      onClick={() => { if (!disabled) onClick(); }}
    >
      {!readOnly && (
        <Switch
          checked={attach}
          onCheckedChange={onToggle}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
    </Card>
  );
}

function networkDescription(log: NetworkLog): string {
  const errorCount = log.requests.filter((r) => r.status >= 400).length;
  return `총 ${log.captured}건 (에러 ${errorCount}건)`;
}

function consoleDescription(log: ConsoleLog): string {
  const errorCount = log.entries.filter((e) => e.level === "error").length;
  return `총 ${log.captured}건 (에러 ${errorCount}건)`;
}
