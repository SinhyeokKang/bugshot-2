import { memo, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { LogSeekChip } from "@/sidepanel/components/LogSeekChip";
import { LevelIcon } from "@/sidepanel/components/ConsoleLogContent";
import { LinkifiedText } from "@/sidepanel/components/LinkifiedText";
import { KindIcon, renderActionContent } from "@/sidepanel/components/ActionLogContent";
import { ContentTypeIcon, methodColor } from "@/sidepanel/components/NetworkLogContent";
import { formatRelativeTime } from "@/sidepanel/lib/logRow";
import { networkLogPath } from "@/lib/network-log-path";
import { TONE_TEXT } from "@/lib/log-colors";
import { isNetworkError, isNetworkPending, isStatusHidden } from "@/lib/network-status";
import { t } from "../i18n";
import { timelineFillClass, type TimelineItem } from "../timeline-merge";

interface TimelineRowProps {
  item: TimelineItem;
  isActive: boolean;
  videoStartedAt: number;
  onSeek: (absTs: number) => void;
  onOpenNetworkDetail: (id: string) => void;
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

function statusLabel(item: Extract<TimelineItem, { kind: "network" }>): string {
  const { req } = item;
  if (isNetworkPending(req)) return "···";
  if (isStatusHidden(req) || req.status <= 0) return "—";
  return String(req.status);
}

// 1행 1이벤트 렌더. 기존 로그 행처럼 컨테이너는 div(중첩 button 무효 HTML 회피) —
// 행 클릭=seek, 내부 seek 칩/chevron/상세는 focus 가능한 button으로 분리.
export const TimelineRow = memo(function TimelineRow({
  item,
  isActive,
  videoStartedAt,
  onSeek,
  onOpenNetworkDetail,
}: TimelineRowProps) {
  const [expanded, setExpanded] = useState(false);
  const canExpand =
    item.kind === "console" && (item.entry.level === "error" || item.entry.level === "warn") && !!item.entry.stack;

  const spine = isActive ? "border-l-primary" : "border-l-muted";
  const fill = timelineFillClass(item);

  return (
    <div
      data-testid="timeline-row"
      data-kind={item.kind}
      data-active={isActive || undefined}
      className={`cursor-pointer border-l-2 ${spine} ${fill}`}
      aria-current={isActive ? "true" : undefined}
      onClick={() => onSeek(item.absTs)}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] hover:bg-accent/50">
        <LogSeekChip ts={item.absTs} label={formatRelativeTime(item.absTs, videoStartedAt)} onSeek={onSeek} />

        {item.kind === "action" && (
          <>
            <KindIcon kind={item.entry.kind} />
            <span className="min-w-0 flex-1 truncate">{renderActionContent(t, item.entry)}</span>
          </>
        )}

        {item.kind === "console" && (
          <>
            <LevelIcon level={item.entry.level} />
            <span className="min-w-0 flex-1 break-all font-mono text-mono">
              <LinkifiedText text={item.entry.args} />
            </span>
            {canExpand && (
              <button
                type="button"
                data-testid="timeline-row-expand"
                className="shrink-0 rounded p-0.5 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-expanded={expanded}
                onClick={(e) => { stop(e); setExpanded((v) => !v); }}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </>
        )}

        {item.kind === "network" && (
          <>
            <ContentTypeIcon req={item.req} />
            <span className="flex shrink-0 items-center gap-1 font-mono text-mono">
              <span className={methodColor(item.req.method)}>{item.req.method}</span>
              <span className="text-muted-foreground">·</span>
              <span className={isNetworkError(item.req) ? TONE_TEXT.red : "text-muted-foreground"}>
                {statusLabel(item)}
              </span>
            </span>
            <span className="min-w-0 flex-1 truncate">{networkLogPath(item.req.url)}</span>
            {!isNetworkPending(item.req) && (
              <span className="shrink-0 font-mono text-mono text-muted-foreground">{item.req.durationMs}ms</span>
            )}
            <button
              type="button"
              data-testid="timeline-row-detail"
              className="shrink-0 rounded px-1.5 py-0.5 font-mono text-mono text-muted-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={(e) => { stop(e); onOpenNetworkDetail(item.req.id); }}
            >
              {t("timeline.detail")}
            </button>
          </>
        )}
      </div>

      {item.kind === "console" && canExpand && expanded && (
        <div className="px-2.5 pb-2 pl-[52px] text-xs">
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-mono">
            <LinkifiedText text={item.entry.stack!} />
          </pre>
        </div>
      )}
    </div>
  );
});
