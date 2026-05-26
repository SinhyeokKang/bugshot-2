import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChevronDown, ChevronUp, CircleX, Info, Search, Terminal, TriangleAlert, X } from "lucide-react";
import { useT } from "@/i18n";
import type { ConsoleEntry, ConsoleLevel } from "@/types/console";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ConsoleFilter = "all" | "error" | "warn" | "info" | "debug" | "log";

const CONSOLE_FILTERS: ConsoleFilter[] = ["all", "error", "warn", "info", "debug", "log"];

interface ConsoleLogContentProps {
  entries: ConsoleEntry[];
  startedAt?: number;
  flush?: boolean;
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

export function ConsoleLogContent({ entries, startedAt, flush }: ConsoleLogContentProps) {
  const t = useT();
  const [filter, setFilter] = useState<ConsoleFilter>("all");
  const [query, setQuery] = useState("");
  const filterLabel: Record<ConsoleFilter, string> = {
    all: t("consoleLog.filter.all"), error: t("consoleLog.filter.error"),
    warn: t("consoleLog.filter.warn"), info: t("consoleLog.filter.info"),
    debug: t("consoleLog.filter.debug"), log: t("consoleLog.filter.log"),
  };
  const availableFilters = useMemo<ConsoleFilter[]>(() => {
    const present: Set<string> = new Set(entries.map((e) => e.level));
    return ["all" as const, ...CONSOLE_FILTERS.filter((f): f is Exclude<ConsoleFilter, "all"> => f !== "all" && present.has(f))];
  }, [entries]);
  useEffect(() => {
    if (filter !== "all" && !availableFilters.includes(filter)) setFilter("all");
  }, [availableFilters, filter]);
  const filteredEntries = useMemo(() => {
    let result = filter === "all" ? entries : entries.filter((e) => e.level === filter);
    if (query) {
      const lower = query.toLowerCase();
      result = result.filter((e) => e.args.toLowerCase().includes(lower));
    }
    return result;
  }, [entries, filter, query]);

  // 신규 로그 tail: 사용자가 바닥 근처(<24px)에 있을 때만 새 항목에 맞춰 자동 스크롤. 위로 올려
  // 살펴보는 중이면 끌어내리지 않는다.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const getListViewport = useCallback(
    () => listScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null,
    [],
  );
  useEffect(() => {
    const vp = getListViewport();
    if (!vp) return;
    const onScroll = () => {
      pinnedRef.current = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 24;
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, [getListViewport]);
  useEffect(() => {
    if (!pinnedRef.current) return;
    const vp = getListViewport();
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [filteredEntries.length, getListViewport]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden${flush ? "" : " rounded-lg border"}`}>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as ConsoleFilter)}>
        <div className={`flex items-center gap-3 border-b${flush ? " px-4 py-4" : " p-2"}`}>
          <TabsList>
            {availableFilters.map((f) => (
              <TabsTrigger key={f} value={f}>
                {filterLabel[f]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="relative ml-auto w-full max-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("consoleLog.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`h-9 pl-8 text-sm ${query ? "pr-8" : ""}`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </Tabs>
      {entries.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <div className="rounded-full bg-muted p-3">
            <Terminal className="h-6 w-6 text-muted-foreground" />
          </div>
          <span className="text-sm text-muted-foreground">{t("debug.console.empty")}</span>
        </div>
      ) : (
        <ScrollArea ref={listScrollRef} className="min-h-0 flex-1">
          <div className="overflow-hidden">
            {filteredEntries.map((entry) => (
              <EntryAccordion key={entry.id} entry={entry} startedAt={startedAt} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function EntryAccordion({ entry, startedAt }: { entry: ConsoleEntry; startedAt?: number }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();

  return (
    <div className={levelBgColor(entry.level)}>
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        {startedAt != null && (
          <span className="w-10 shrink-0 font-mono text-[12px]">{formatRelativeTime(entry.timestamp, startedAt)}</span>
        )}
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
        <div className={`space-y-2 pb-3 pr-3 pt-1 text-[12px] ${startedAt != null ? "pl-[64px]" : "pl-10"}`}>
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
