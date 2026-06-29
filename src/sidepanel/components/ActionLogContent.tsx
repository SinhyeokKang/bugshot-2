import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Keyboard, MousePointerClick, MapPin, Search, X, CornerDownLeft, SquareCheck, ListChecks } from "lucide-react";
import { useT } from "@/i18n";
import type { ActionEntry, ActionEntryKind } from "@/types/action";
import type { TranslationFn } from "@/i18n";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { findActiveIndex } from "@/log-viewer/timeline";
import { formatRelativeTime, syncRowClass } from "@/sidepanel/lib/logRow";
import { useScrollToEntry } from "@/sidepanel/lib/useScrollToEntry";
import { distinctOriginKeys, originKey, originCounts } from "@/sidepanel/lib/logOrigin";
import { splitTemplate, resolveClickTarget } from "@/sidepanel/lib/actionInline";
import { InlineLink } from "./InlineLink";
import { InlineChip } from "./InlineChip";
import { OriginFilterBar } from "./OriginFilterBar";
import { LogSeekChip } from "./LogSeekChip";

type ActionFilter = "all" | ActionEntryKind;

const ACTION_FILTERS: ActionEntryKind[] = ["click", "navigation", "input", "keypress", "toggle", "select"];

interface ActionLogContentProps {
  entries: ActionEntry[];
  startedAt?: number;
  flush?: boolean;
  // 영상 동기화(log-viewer 전용, optional). 미공급 시 라이브 서브탭과 동일 동작.
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
  activeTs?: number;
  scrollToEntryId?: string | null;
  onScrollComplete?: () => void;
}

// navigation만 콘솔 info-틴트 배경 재사용, click/input은 중립(배경 없음).
function kindBgColor(kind: ActionEntryKind): string {
  return kind === "navigation" ? "bg-blue-100 dark:bg-blue-950/50" : "";
}

function KindIcon({ kind }: { kind: ActionEntryKind }) {
  const base = "h-4 w-4 shrink-0";
  switch (kind) {
    case "click": return <MousePointerClick className={base} />;
    case "input": return <Keyboard className={base} />;
    case "navigation": return <MapPin className={`${base} text-blue-600 dark:text-blue-400`} />;
    case "keypress": return <CornerDownLeft className={base} />;
    case "toggle": return <SquareCheck className={base} />;
    case "select": return <ListChecks className={base} />;
    default: { kind satisfies never; return null; }
  }
}

const MASKED_DISPLAY = "[********]";

function ClickTarget({ entry }: { entry: ActionEntry }) {
  const view = resolveClickTarget(entry);
  if (view.mode === "name") return <>{view.name}</>;
  if (view.mode === "tag") {
    return (
      <span data-testid="action-tag">
        <span aria-hidden="true">&lt;</span>
        <span className="text-sky-600 dark:text-sky-400">{view.tagName}</span>
        {view.tagType && (
          <>
            {" "}
            <span className="text-amber-600 dark:text-amber-400">type</span>
            <span aria-hidden="true">=&quot;</span>
            <span className="text-red-700 dark:text-red-400">{view.tagType}</span>
            <span aria-hidden="true">&quot;</span>
          </>
        )}
        <span aria-hidden="true">&gt;</span>
      </span>
    );
  }
  return null;
}

function renderVerb(template: string, slots: Record<string, ReactNode>): ReactNode {
  return splitTemplate(template).map((tok, i) => (
    <Fragment key={i}>{tok.type === "slot" ? slots[tok.name] ?? "" : tok.value}</Fragment>
  ));
}

function fieldText(entry: ActionEntry): string {
  return `"${entry.fieldLabel ?? entry.selector ?? ""}"`;
}

function valueChip(value: string | undefined): ReactNode {
  return value ? <InlineChip data-testid="action-value-chip">{value}</InlineChip> : "";
}

function renderActionContent(t: TranslationFn, entry: ActionEntry): ReactNode {
  switch (entry.kind) {
    case "click":
      return renderVerb(t("actionLog.verb.click"), { target: <ClickTarget entry={entry} /> });
    case "input":
      return renderVerb(t("actionLog.verb.input"), {
        value: entry.masked
          ? <InlineChip muted aria-label={t("actionLog.maskedValue")} data-testid="action-value-chip">{MASKED_DISPLAY}</InlineChip>
          : valueChip(entry.value),
        field: fieldText(entry),
      });
    case "select":
      return renderVerb(t("actionLog.verb.select"), { value: valueChip(entry.value), field: fieldText(entry) });
    case "keypress":
      return renderVerb(t("actionLog.verb.keypress"), { keys: valueChip(entry.value) });
    case "toggle":
      return renderVerb(
        t(entry.value === "checked" ? "actionLog.verb.toggle.check" : "actionLog.verb.toggle.uncheck"),
        { field: fieldText(entry) },
      );
    case "navigation":
      return renderVerb(t("actionLog.verb.navigate"), {
        target: entry.toUrl
          ? <InlineLink href={entry.toUrl} title={entry.toUrl} data-testid="action-nav-link" />
          : "",
      });
    default: { entry.kind satisfies never; return null; }
  }
}

function searchText(e: ActionEntry): string {
  return [e.target, e.fieldLabel, e.value, e.toUrl].filter(Boolean).join(" ").toLowerCase();
}

export function ActionLogContent({ entries, startedAt, flush, syncBaseMs, onSeek, activeTs, scrollToEntryId, onScrollComplete }: ActionLogContentProps) {
  const t = useT();
  const [filter, setFilter] = useState<ActionFilter>("all");
  const [originFilter, setOriginFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const filterLabel: Record<ActionFilter, string> = {
    all: t("actionLog.filter.all"),
    click: t("actionLog.filter.click"),
    navigation: t("actionLog.filter.navigation"),
    input: t("actionLog.filter.input"),
    keypress: t("actionLog.filter.keypress"),
    toggle: t("actionLog.filter.toggle"),
    select: t("actionLog.filter.select"),
  };
  const availableFilters = useMemo<ActionFilter[]>(() => {
    const present = new Set(entries.map((e) => e.kind));
    return ["all" as const, ...ACTION_FILTERS.filter((f) => present.has(f))];
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
    let result = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
    if (originFilter !== null) result = result.filter((e) => originKey(e.pageUrl) === originFilter);
    if (query) {
      const lower = query.toLowerCase();
      result = result.filter((e) => searchText(e).includes(lower));
    }
    return result;
  }, [entries, filter, originFilter, query]);

  const activeId = useMemo(() => {
    if (activeTs == null) return null;
    const idx = findActiveIndex(filteredEntries.map((e) => e.timestamp), activeTs);
    return idx >= 0 ? filteredEntries[idx].id : null;
  }, [filteredEntries, activeTs]);

  // tail 자동스크롤 — 바닥 근처(<24px)에 있을 때만 새 항목에 맞춰 내린다.
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
      <Tabs value={filter} onValueChange={(v) => setFilter(v as ActionFilter)}>
        <div className={`flex items-center gap-3${originKeys.length >= 2 ? "" : " border-b"}${flush ? " px-4 py-4" : " p-2"}`}>
          <div className="min-w-0 overflow-x-auto">
            <TabsList>
              {availableFilters.map((f) => (
                <TabsTrigger key={f} value={f} data-testid={`action-filter-${f}`}>
                  {filterLabel[f]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="relative ml-auto w-full max-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="action-search"
              placeholder={t("actionLog.search")}
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
            <MousePointerClick className="h-6 w-6 text-muted-foreground" />
          </div>
          <span className="text-sm text-muted-foreground">{t("actionLog.empty")}</span>
        </div>
      ) : (
        <ScrollArea ref={listScrollRef} className="min-h-0 flex-1">
          <div className="overflow-hidden">
            {filteredEntries.map((entry) => (
              <ActionRow
                key={entry.id}
                entry={entry}
                startedAt={startedAt}
                syncBaseMs={syncBaseMs}
                onSeek={onSeek}
                isActive={entry.id === activeId}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ActionRow({ entry, startedAt, syncBaseMs, onSeek, isActive }: {
  entry: ActionEntry;
  startedAt?: number;
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
  isActive?: boolean;
}) {
  const t = useT();
  const base = syncBaseMs ?? startedAt;
  return (
    <div
      data-entry-id={entry.id}
      data-kind={entry.kind}
      className={syncRowClass(!!onSeek, !!isActive, kindBgColor(entry.kind))}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="flex items-center gap-3 px-2.5 py-2 text-[13px]">
        {base != null && (
          <LogSeekChip ts={entry.timestamp} label={formatRelativeTime(entry.timestamp, base)} onSeek={onSeek} />
        )}
        <KindIcon kind={entry.kind} />
        <span className="min-w-0 flex-1 break-words leading-relaxed">
          {renderActionContent(t, entry)}
        </span>
      </div>
    </div>
  );
}
