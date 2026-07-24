import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal, ArrowLeftRight, MousePointerClick, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebouncedValue } from "@/sidepanel/lib/useDebouncedValue";
import { findActiveIndex } from "../timeline";
import { matchesTimelineItem, type TimelineItem, type TimelineKind } from "../timeline-merge";
import { TimelineRow } from "./TimelineRow";
import { t } from "../i18n";

interface TimelinePanelProps {
  items: TimelineItem[];
  videoStartedAt: number;
  // playhead 구독 등록(ref 중계) — App state 없이 timeupdate 리렌더를 이 서브트리에 격리.
  setTimeListener: (fn: ((sec: number) => void) | null) => void;
  onSeek: (absTs: number) => void;
  onOpenNetworkDetail: (id: string) => void;
}

const KIND_META: { kind: TimelineKind; icon: typeof Terminal; labelKey: string }[] = [
  { kind: "console", icon: Terminal, labelKey: "timeline.filter.console" },
  { kind: "network", icon: ArrowLeftRight, labelKey: "timeline.filter.network" },
  { kind: "action", icon: MousePointerClick, labelKey: "timeline.filter.action" },
];

export function TimelinePanel({ items, videoStartedAt, setTimeListener, onSeek, onOpenNetworkDetail }: TimelinePanelProps) {
  const [currentAbsMs, setCurrentAbsMs] = useState(videoStartedAt);
  const [kinds, setKinds] = useState<Set<TimelineKind>>(() => new Set(["console", "network", "action"]));
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    setTimeListener((sec) => setCurrentAbsMs(videoStartedAt + sec * 1000));
    return () => setTimeListener(null);
  }, [setTimeListener, videoStartedAt]);

  // 존재하는 kind만 토글 노출(빈 타입 버튼 방지).
  const presentKinds = useMemo(() => {
    const set = new Set(items.map((i) => i.kind));
    return KIND_META.filter((m) => set.has(m.kind));
  }, [items]);

  const filtered = useMemo(
    () => items.filter((i) => matchesTimelineItem(i, kinds, debouncedQuery)),
    [items, kinds, debouncedQuery],
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
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2">
        <ToggleGroup
          type="multiple"
          size="sm"
          variant="outline"
          value={[...kinds]}
          onValueChange={(v) => setKinds(new Set(v as TimelineKind[]))}
        >
          {presentKinds.map(({ kind, icon: Icon, labelKey }) => (
            <ToggleGroupItem key={kind} value={kind} data-testid={`timeline-filter-${kind}`} className="gap-1 px-2 text-xs">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {t(labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative ml-auto min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="timeline-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("timeline.searchPlaceholder")}
            className="h-8 pl-8"
          />
        </div>
      </div>

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
              onSeek={onSeek}
              onOpenNetworkDetail={onOpenNetworkDetail}
            />
          ))
        )}
      </div>
    </div>
  );
}
