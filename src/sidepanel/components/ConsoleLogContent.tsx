import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChevronDown, ChevronUp, CircleX, Info, Search, Terminal, TriangleAlert, X } from "lucide-react";
import { useT } from "@/i18n";
import type { ConsoleEntry, ConsoleLevel } from "@/types/console";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { distinctOriginKeys, originKey, originCounts } from "@/sidepanel/lib/logOrigin";
import { OriginFilterBar } from "./OriginFilterBar";
import { findActiveIndex } from "@/log-viewer/timeline";
import { formatRelativeTime, syncRowClass } from "@/sidepanel/lib/logRow";
import { useScrollToEntry } from "@/sidepanel/lib/useScrollToEntry";
import { InlineLink } from "./InlineLink";
import { LinkifiedText } from "./LinkifiedText";
import { LogSeekChip } from "./LogSeekChip";

type ConsoleFilter = "all" | "error" | "warn" | "info" | "debug" | "log";

const CONSOLE_FILTERS: ConsoleFilter[] = ["all", "error", "warn", "info", "debug", "log"];

interface ConsoleLogContentProps {
  entries: ConsoleEntry[];
  startedAt?: number;
  flush?: boolean;
  // 영상 동기화(log-viewer 전용, optional). 미공급 시 라이브 서브탭과 동일 동작.
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
  activeTs?: number;
  scrollToEntryId?: string | null;
  onScrollComplete?: () => void;
  isMuted?: (absTs: number) => boolean; // 트림 후보(잘려나갈 로그) 흐림 판정
}

function levelBgColor(level: ConsoleLevel): string {
  switch (level) {
    case "error": return "bg-red-100 dark:bg-red-950/50";
    case "warn": return "bg-amber-100 dark:bg-amber-950/50";
    case "info": return "bg-blue-100 dark:bg-blue-950/50";
    default: return "";
  }
}

function levelCodeBg(level: ConsoleLevel): string {
  switch (level) {
    case "error": return "bg-red-200 dark:bg-red-950/70";
    case "warn": return "bg-amber-200 dark:bg-amber-950/70";
    case "info": return "bg-blue-200 dark:bg-blue-950/70";
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

export function ConsoleLogContent({ entries, startedAt, flush, syncBaseMs, onSeek, activeTs, scrollToEntryId, onScrollComplete, isMuted }: ConsoleLogContentProps) {
  const t = useT();
  const [filter, setFilter] = useState<ConsoleFilter>("all");
  const [originFilter, setOriginFilter] = useState<string | null>(null);
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
  const originKeys = useMemo(() => distinctOriginKeys(entries.map((e) => e.pageUrl)), [entries]);
  const originCountMap = useMemo(() => originCounts(entries.map((e) => e.pageUrl)), [entries]);
  useEffect(() => {
    if (originFilter !== null && !originKeys.includes(originFilter)) setOriginFilter(null);
  }, [originKeys, originFilter]);
  const filteredEntries = useMemo(() => {
    let result = filter === "all" ? entries : entries.filter((e) => e.level === filter);
    if (originFilter !== null) result = result.filter((e) => originKey(e.pageUrl) === originFilter);
    if (query) {
      const lower = query.toLowerCase();
      result = result.filter((e) => e.args.toLowerCase().includes(lower));
    }
    return result;
  }, [entries, filter, originFilter, query]);

  const activeId = useMemo(() => {
    if (activeTs == null) return null;
    const idx = findActiveIndex(filteredEntries.map((e) => e.timestamp), activeTs);
    return idx >= 0 ? filteredEntries[idx].id : null;
  }, [filteredEntries, activeTs]);

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

  useScrollToEntry({
    scrollToEntryId,
    getListViewport,
    filteredItems: filteredEntries,
    resetFilters: useCallback(() => { setFilter("all"); setOriginFilter(null); setQuery(""); }, []),
    onScrollComplete,
  });

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden${flush ? "" : " rounded-lg border"}`}>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as ConsoleFilter)}>
        <div className={`flex items-center gap-3${originKeys.length >= 2 ? "" : " border-b"}${flush ? " px-4 py-4" : " p-2"}`}>
          <div className="min-w-0 overflow-x-auto">
            <TabsList>
              {availableFilters.map((f) => (
                <TabsTrigger key={f} value={f} data-testid={`console-filter-${f}`}>
                  {filterLabel[f]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="relative ml-auto w-full max-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="console-search"
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
      <OriginFilterBar originKeys={originKeys} counts={originCountMap} value={originFilter} onChange={setOriginFilter} flush={flush} />
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
              <EntryAccordion
                key={entry.id}
                entry={entry}
                startedAt={startedAt}
                syncBaseMs={syncBaseMs}
                onSeek={onSeek}
                isActive={entry.id === activeId}
                scrollToEntryId={scrollToEntryId}
                muted={isMuted?.(entry.timestamp) ?? false}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function EntryAccordion({ entry, startedAt, syncBaseMs, onSeek, isActive, scrollToEntryId, muted }: {
  entry: ConsoleEntry;
  startedAt?: number;
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
  isActive?: boolean;
  scrollToEntryId?: string | null;
  muted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!scrollToEntryId) return;
    setExpanded(entry.id === scrollToEntryId);
  }, [scrollToEntryId, entry.id]);
  const t = useT();
  const base = syncBaseMs ?? startedAt;

  return (
    <div
      data-entry-id={entry.id}
      data-level={entry.level}
      data-muted={muted || undefined}
      className={`${syncRowClass(!!onSeek, !!isActive, levelBgColor(entry.level))}${muted ? " opacity-40" : ""}`}
      aria-current={isActive ? "true" : undefined}
    >
      <div
        className="flex cursor-pointer items-center gap-3 px-2.5 py-2 text-[13px] hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        {base != null && (
          <LogSeekChip ts={entry.timestamp} label={formatRelativeTime(entry.timestamp, base)} onSeek={onSeek} />
        )}
        <LevelIcon level={entry.level} />
        <span className="min-w-0 flex-1 break-all">
          <LinkifiedText text={entry.args} />
        </span>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        }
      </div>

      {expanded && (
        <div className={`space-y-2 pb-3 pr-3 pt-1 text-xs ${base != null ? "pl-[64px]" : "pl-10"}`}>
          <pre className={`max-h-[300px] overflow-auto rounded p-2 font-mono text-xs whitespace-pre-wrap break-all ${levelCodeBg(entry.level)}`}>
            <LinkifiedText text={entry.args} />
          </pre>
          {entry.stack && (
            <div>
              <div className="mb-1 text-xs font-medium">
                {t("consoleLog.detail.stackTrace")}
              </div>
              <pre data-testid="console-stack" className={`max-h-[200px] overflow-auto rounded p-2 font-mono text-xs whitespace-pre-wrap break-all ${levelCodeBg(entry.level)}`}>
                <LinkifiedText text={entry.stack} />
              </pre>
            </div>
          )}
          <InlineLink href={entry.pageUrl} className="block text-xs">{entry.pageUrl}</InlineLink>
        </div>
      )}
    </div>
  );
}
