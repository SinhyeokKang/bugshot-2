import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ConsoleLogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ConsoleEntry[];
}

function levelColor(level: ConsoleLevel): string {
  switch (level) {
    case "error": return "text-red-600 dark:text-red-400";
    case "warn": return "text-amber-600 dark:text-amber-400";
    case "info": return "text-blue-600 dark:text-blue-400";
    case "debug": return "text-muted-foreground";
    default: return "text-foreground";
  }
}

function levelBadgeVariant(level: ConsoleLevel): "destructive" | "secondary" {
  return level === "error" ? "destructive" : "secondary";
}

function isErrorLevel(level: ConsoleLevel): boolean {
  return level === "error" || level === "warn";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
}

export function ConsoleLogPreviewDialog({
  open,
  onOpenChange,
  entries,
}: ConsoleLogPreviewDialogProps) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);

  const errors = useMemo(() => entries.filter((e) => isErrorLevel(e.level)), [entries]);
  const others = useMemo(() => entries.filter((e) => !isErrorLevel(e.level)), [entries]);
  const activeEntry = useMemo(() => entries.find((e) => e.id === activeId) ?? null, [entries, activeId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("consoleLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
          {/* List */}
          <ScrollArea className="w-[200px] shrink-0 border-r">
            <div className="p-2">
              {errors.length > 0 && (
                <>
                  <div className="mb-1 px-2 text-xs font-medium text-destructive">{t("consoleLog.dialog.errors")}</div>
                  {errors.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      active={activeId === e.id}
                      onClick={() => setActiveId(e.id)}
                    />
                  ))}
                </>
              )}
              {others.length > 0 && (
                <>
                  <div className="mb-1 mt-2 px-2 text-xs font-medium text-muted-foreground">{t("consoleLog.dialog.other")}</div>
                  {others.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      active={activeId === e.id}
                      onClick={() => setActiveId(e.id)}
                    />
                  ))}
                </>
              )}
            </div>
          </ScrollArea>

          {/* Detail */}
          <ScrollArea className="min-w-0 flex-1">
            {activeEntry ? (
              <EntryDetail entry={activeEntry} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("consoleLog.dialog.selectEntry")}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="!flex-row items-center !justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({
  entry,
  active,
  onClick,
}: {
  entry: ConsoleEntry;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs ${active ? "bg-accent" : "hover:bg-accent/50"}`}
      onClick={onClick}
    >
      <Badge
        variant={levelBadgeVariant(entry.level)}
        className="h-4 shrink-0 px-1 text-[10px] uppercase"
      >
        {entry.level}
      </Badge>
      <span className="shrink-0 text-muted-foreground">{formatTime(entry.timestamp)}</span>
      <span className={`min-w-0 flex-1 truncate font-mono ${levelColor(entry.level)}`}>
        {entry.args}
      </span>
    </div>
  );
}

function EntryDetail({ entry }: { entry: ConsoleEntry }) {
  const t = useT();
  return (
    <div className="space-y-3 p-4 text-xs">
      <div>
        <div className="mb-1 font-medium">{t("consoleLog.detail.general")}</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">{t("consoleLog.detail.level")}</dt>
          <dd>
            <Badge variant={levelBadgeVariant(entry.level)} className="h-4 px-1 text-[10px] uppercase">
              {entry.level}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">{t("consoleLog.detail.time")}</dt>
          <dd>{formatTime(entry.timestamp)}</dd>
          <dt className="text-muted-foreground">{t("consoleLog.detail.page")}</dt>
          <dd className="break-all">{entry.pageUrl}</dd>
        </dl>
      </div>

      <CollapsibleSection title={t("consoleLog.detail.message")} defaultOpen>
        <pre className="max-h-[300px] overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap break-all">
          {entry.args}
        </pre>
      </CollapsibleSection>

      {entry.stack && (
        <CollapsibleSection title={t("consoleLog.detail.stackTrace")}>
          <pre className="max-h-[200px] overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap break-all text-muted-foreground">
            {entry.stack}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs font-medium hover:underline">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
