import { useState } from "react";
import { ChevronDown, ChevronUp, CircleX, Info, Terminal, TriangleAlert } from "lucide-react";
import { useT } from "@/i18n";
import type { ConsoleEntry, ConsoleLevel } from "@/types/console";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConsoleLogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ConsoleEntry[];
  startedAt: number;
  attach?: boolean;
  onToggleAttach?: (attach: boolean) => void;
}

function levelColor(level: ConsoleLevel): string {
  switch (level) {
    case "error": return "text-red-600 dark:text-red-400";
    case "warn": return "text-amber-600 dark:text-amber-400";
    case "info": return "text-blue-600 dark:text-blue-400";
    case "debug": return "text-foreground";
    default: return "text-foreground";
  }
}

function levelBgColor(level: ConsoleLevel): string {
  switch (level) {
    case "error": return "bg-red-50 dark:bg-red-950/30";
    case "warn": return "bg-amber-50 dark:bg-amber-950/30";
    case "info": return "bg-blue-50 dark:bg-blue-950/30";
    default: return "";
  }
}

function levelCodeBg(level: ConsoleLevel): string {
  switch (level) {
    case "error": return "bg-red-100 dark:bg-red-950/50";
    case "warn": return "bg-amber-100 dark:bg-amber-950/50";
    case "info": return "bg-blue-100 dark:bg-blue-950/50";
    default: return "bg-muted";
  }
}

function LevelIcon({ level }: { level: ConsoleLevel }) {
  const base = "h-4 w-4 shrink-0";
  switch (level) {
    case "error": return <CircleX className={`${base} text-red-600 dark:text-red-400`} />;
    case "warn": return <TriangleAlert className={`${base} text-amber-600 dark:text-amber-400`} />;
    case "info": return <Info className={`${base} text-blue-600 dark:text-blue-400`} />;
    case "debug": return <Terminal className={base} />;
    default: return <Terminal className={base} />;
  }
}

function formatRelativeTime(ts: number, baseTs: number): string {
  const diff = Math.max(0, Math.round((ts - baseTs) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ConsoleLogPreviewDialog({
  open,
  onOpenChange,
  entries,
  startedAt,
  attach,
  onToggleAttach,
}: ConsoleLogPreviewDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("consoleLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 rounded-lg border">
          <div className="overflow-hidden">
            {entries.map((entry) => (
              <EntryAccordion key={entry.id} entry={entry} startedAt={startedAt} />
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          {onToggleAttach && (
            <Button onClick={() => { onToggleAttach(!attach); onOpenChange(false); }}>
              {attach ? t("common.detach") : t("common.attach")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryAccordion({ entry, startedAt }: { entry: ConsoleEntry; startedAt: number }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();

  return (
    <div className={levelBgColor(entry.level)}>
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-10 shrink-0 font-mono text-[12px]">{formatRelativeTime(entry.timestamp, startedAt)}</span>
        <LevelIcon level={entry.level} />
        <span className={`min-w-0 flex-1 break-all ${levelColor(entry.level)}`}>
          {entry.args}
        </span>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        }
      </div>

      {expanded && (
        <div className="space-y-2 pb-3 pl-[64px] pr-3 pt-1 text-[12px]">
          <pre className={`max-h-[300px] overflow-auto rounded p-2 font-sans text-[12px] whitespace-pre-wrap break-all ${levelCodeBg(entry.level)}`}>
            {entry.args}
          </pre>
          {entry.stack && (
            <div>
              <div className="mb-1 text-[12px] font-medium">
                {t("consoleLog.detail.stackTrace")}
              </div>
              <pre className={`max-h-[200px] overflow-auto rounded p-2 font-sans text-[12px] whitespace-pre-wrap break-all ${levelCodeBg(entry.level)}`}>
                {entry.stack}
              </pre>
            </div>
          )}
          <a href={entry.pageUrl} target="_blank" rel="noopener noreferrer" className="block text-[12px] text-blue-600 underline dark:text-blue-400">{entry.pageUrl}</a>
        </div>
      )}
    </div>
  );
}
