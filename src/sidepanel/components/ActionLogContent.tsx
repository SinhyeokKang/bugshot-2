import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Keyboard, MousePointerClick, MapPin, Search, X } from "lucide-react";
import { useT } from "@/i18n";
import type { ActionEntry, ActionEntryKind } from "@/types/action";
import type { TranslationFn } from "@/i18n";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ActionFilter = "all" | ActionEntryKind;

const ACTION_FILTERS: ActionEntryKind[] = ["click", "navigation", "input"];

interface ActionLogContentProps {
  entries: ActionEntry[];
  startedAt?: number;
  flush?: boolean;
}

// navigation만 콘솔 info-틴트 슬롯 재사용, click/input은 중립.
function kindColor(kind: ActionEntryKind): string {
  return kind === "navigation" ? "text-blue-600 dark:text-blue-400" : "text-foreground";
}

function kindBgColor(kind: ActionEntryKind): string {
  return kind === "navigation" ? "bg-blue-50 dark:bg-blue-950/30" : "";
}

function KindIcon({ kind }: { kind: ActionEntryKind }) {
  const base = "h-4 w-4 shrink-0";
  switch (kind) {
    case "click": return <MousePointerClick className={base} />;
    case "input": return <Keyboard className={base} />;
    case "navigation": return <MapPin className={`${base} text-blue-600 dark:text-blue-400`} />;
  }
}

function formatRelativeTime(ts: number, baseTs: number): string {
  const diff = Math.max(0, Math.round((ts - baseTs) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const MASKED_DISPLAY = "[********]";

function roleWord(t: TranslationFn, role?: string): string {
  switch (role) {
    case "button": return t("actionLog.role.button");
    case "link": return t("actionLog.role.link");
    case "checkbox": return t("actionLog.role.checkbox");
    case "radio": return t("actionLog.role.radio");
    case "tab": return t("actionLog.role.tab");
    case "menuitem": return t("actionLog.role.menuitem");
    case "textbox": return t("actionLog.role.textbox");
    default: return "";
  }
}

function clickTarget(t: TranslationFn, entry: ActionEntry): string {
  const name = entry.target ?? entry.selector ?? "";
  const rw = roleWord(t, entry.role);
  return rw ? `"${name}" ${rw}` : `"${name}"`;
}

// 동사 문장 중간에 URL 링크(JSX)를 끼우려면 {target} 슬롯으로 split해 양옆 텍스트와 링크를 조립.
function NavigateText({ t, toUrl }: { t: TranslationFn; toUrl?: string }) {
  const [pre, post] = t("actionLog.verb.navigate").split("{target}");
  return (
    <>
      {pre}
      {toUrl && (
        <a
          href={toUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline dark:text-blue-400"
          title={toUrl}
        >
          {toUrl}
        </a>
      )}
      {post ?? ""}
    </>
  );
}

function searchText(e: ActionEntry): string {
  return [e.target, e.fieldLabel, e.value, e.toUrl].filter(Boolean).join(" ").toLowerCase();
}

export function ActionLogContent({ entries, startedAt, flush }: ActionLogContentProps) {
  const t = useT();
  const [filter, setFilter] = useState<ActionFilter>("all");
  const [query, setQuery] = useState("");
  const filterLabel: Record<ActionFilter, string> = {
    all: t("actionLog.filter.all"),
    click: t("actionLog.filter.click"),
    navigation: t("actionLog.filter.navigation"),
    input: t("actionLog.filter.input"),
  };
  const availableFilters = useMemo<ActionFilter[]>(() => {
    const present = new Set(entries.map((e) => e.kind));
    return ["all" as const, ...ACTION_FILTERS.filter((f) => present.has(f))];
  }, [entries]);
  useEffect(() => {
    if (filter !== "all" && !availableFilters.includes(filter)) setFilter("all");
  }, [availableFilters, filter]);
  const filteredEntries = useMemo(() => {
    let result = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
    if (query) {
      const lower = query.toLowerCase();
      result = result.filter((e) => searchText(e).includes(lower));
    }
    return result;
  }, [entries, filter, query]);

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

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden${flush ? "" : " rounded-lg border"}`}>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as ActionFilter)}>
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
              <ActionRow key={entry.id} entry={entry} startedAt={startedAt} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ActionRow({ entry, startedAt }: { entry: ActionEntry; startedAt?: number }) {
  const t = useT();
  return (
    <div className={kindBgColor(entry.kind)}>
      <div className="flex items-center gap-3 px-3 py-2 text-[13px]">
        {startedAt != null && (
          <span className="w-10 shrink-0 font-mono text-xs">{formatRelativeTime(entry.timestamp, startedAt)}</span>
        )}
        <KindIcon kind={entry.kind} />
        <span className={`min-w-0 flex-1 truncate ${kindColor(entry.kind)}`}>
          {entry.kind === "click" && t("actionLog.verb.click", { target: clickTarget(t, entry) })}
          {entry.kind === "input" &&
            t("actionLog.verb.input", {
              field: `"${entry.fieldLabel ?? entry.selector ?? ""}"`,
              value: entry.masked ? MASKED_DISPLAY : `"${entry.value ?? ""}"`,
            })}
          {entry.kind === "navigation" && <NavigateText t={t} toUrl={entry.toUrl} />}
        </span>
      </div>
    </div>
  );
}
