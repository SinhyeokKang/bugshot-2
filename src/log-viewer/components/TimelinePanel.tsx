import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/sidepanel/lib/useDebouncedValue";
import { findActiveIndex } from "../timeline";
import { matchesTimelineItem, type TimelineFilter, type TimelineItem, type TimelineKind } from "../timeline-merge";
import { TimelineRow } from "./TimelineRow";
import { t } from "../i18n";

interface TimelinePanelProps {
  items: TimelineItem[];
  videoStartedAt: number;
  // playhead 구독 등록(ref 중계) — App state 없이 timeupdate 리렌더를 이 서브트리에 격리.
  setTimeListener: (fn: ((sec: number) => void) | null) => void;
  // 행 클릭: 영상 seek + 해당 로그 탭 조회를 동시 발화.
  onActivate: (item: TimelineItem) => void;
}

const KIND_LABEL: Record<TimelineKind, string> = {
  console: "timeline.filter.console",
  network: "timeline.filter.network",
  action: "timeline.filter.action",
};

export function TimelinePanel({ items, videoStartedAt, setTimeListener, onActivate }: TimelinePanelProps) {
  const [currentAbsMs, setCurrentAbsMs] = useState(videoStartedAt);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    setTimeListener((sec) => setCurrentAbsMs(videoStartedAt + sec * 1000));
    return () => setTimeListener(null);
  }, [setTimeListener, videoStartedAt]);

  // 존재하는 kind만 필터 탭 노출(빈 타입 탭 방지). All은 항상.
  const filters = useMemo<TimelineFilter[]>(() => {
    const present = new Set(items.map((i) => i.kind));
    return ["all", ...(["console", "network", "action"] as TimelineKind[]).filter((k) => present.has(k))];
  }, [items]);

  // 필터로 사라진 선택은 all로 복귀.
  useEffect(() => {
    if (filter !== "all" && !filters.includes(filter)) setFilter("all");
  }, [filters, filter]);

  const filtered = useMemo(
    () => items.filter((i) => matchesTimelineItem(i, filter, debouncedQuery)),
    [items, filter, debouncedQuery],
  );

  // absTs 배열은 filtered에만 의존 — playhead tick(~4/s)마다 재할당하지 않는다(worst-case 8000길이).
  const absTsList = useMemo(() => filtered.map((i) => i.absTs), [filtered]);
  const activeIdx = useMemo(() => findActiveIndex(absTsList, currentAbsMs), [absTsList, currentAbsMs]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolling = useRef(false);
  const programmatic = useRef(false);
  const userTimer = useRef<ReturnType<typeof setTimeout>>();
  const progTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleScroll = useCallback(() => {
    // 자동 스크롤(scrollIntoView)이 발화한 scroll은 가드 판정에서 제외(자기 오염 순환 방지).
    if (programmatic.current) return;
    userScrolling.current = true;
    clearTimeout(userTimer.current);
    userTimer.current = setTimeout(() => { userScrolling.current = false; }, 2000);
  }, []);

  useEffect(() => () => { clearTimeout(userTimer.current); clearTimeout(progTimer.current); }, []);

  useEffect(() => {
    if (activeIdx < 0 || userScrolling.current) return;
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (!el) return;
    programmatic.current = true;
    el.scrollIntoView({ block: "nearest" });
    clearTimeout(progTimer.current);
    progTimer.current = setTimeout(() => { programmatic.current = false; }, 150);
  }, [activeIdx]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as TimelineFilter)}>
        <div className="flex items-center gap-3 border-b px-4 py-4">
          <div className="min-w-0 overflow-x-auto">
            <TabsList>
              {filters.map((f) => (
                <TabsTrigger key={f} value={f} data-testid={`timeline-filter-${f}`}>
                  {f === "all" ? t("timeline.filter.all") : t(KIND_LABEL[f])}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="relative ml-auto w-full max-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="timeline-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("timeline.searchPlaceholder")}
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

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto" data-testid="timeline-scroll">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground/70">
            {t("timeline.empty")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground/70">
            {t("timeline.filterEmpty")}
          </div>
        ) : (
          filtered.map((item, i) => (
            <TimelineRow
              key={`${item.kind}:${item.id}`}
              item={item}
              isActive={i === activeIdx}
              videoStartedAt={videoStartedAt}
              onActivate={onActivate}
            />
          ))
        )}
      </div>
    </div>
  );
}
