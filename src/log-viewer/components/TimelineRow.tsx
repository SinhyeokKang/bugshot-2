import { memo, useState, Fragment, type MouseEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { LogSeekChip } from "@/sidepanel/components/LogSeekChip";
import { LevelIcon } from "@/sidepanel/components/ConsoleLogContent";
import { LinkifiedText } from "@/sidepanel/components/LinkifiedText";
import { KindIcon, renderActionContent } from "@/sidepanel/components/ActionLogContent";
import { ContentTypeIcon, methodColor } from "@/sidepanel/components/NetworkLogContent";
import { splitTemplate } from "@/sidepanel/lib/actionInline";
import { formatRelativeTime } from "@/sidepanel/lib/logRow";
import { networkLogPath } from "@/lib/network-log-path";
import { TONE_TEXT } from "@/lib/log-colors";
import { isNetworkError, isNetworkPending, isStatusHidden } from "@/lib/network-status";
import { t } from "../i18n";
import { timelineFillClass, type TimelineItem } from "../timeline-merge";

type NetworkReq = Extract<TimelineItem, { kind: "network" }>["req"];

// method → 자연어 동사 키(i18n `timeline.net.verb.*`). action 로그처럼 문장을 조립한다.
function netVerbKey(req: NetworkReq): string {
  if (req.webSocket) return "connected";
  switch (req.method.toUpperCase()) {
    case "GET": return "fetched";
    case "POST": return "posted";
    case "PUT":
    case "PATCH": return "updated";
    case "DELETE": return "deleted";
    case "HEAD":
    case "OPTIONS": return "checked";
    default: return "requested";
  }
}

interface TimelineRowProps {
  item: TimelineItem;
  isActive: boolean;
  videoStartedAt: number;
  // 행 클릭: 영상 seek + 해당 로그 탭 조회를 동시 발화(App에서 배선).
  onActivate: (item: TimelineItem) => void;
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

function statusLabel(req: NetworkReq): string {
  if (isNetworkPending(req)) return "···";
  if (isStatusHidden(req) || req.status <= 0) return "—";
  return String(req.status);
}

// 1행 1이벤트 렌더. 기존 로그 행처럼 컨테이너는 div(중첩 button 무효 HTML 회피) —
// 행 클릭=activate(seek+탭 조회), 내부 seek 칩/chevron은 focus 가능한 button으로 분리.
export const TimelineRow = memo(function TimelineRow({
  item,
  isActive,
  videoStartedAt,
  onActivate,
}: TimelineRowProps) {
  const [expanded, setExpanded] = useState(false);
  const canExpand =
    item.kind === "console" && (item.entry.level === "error" || item.entry.level === "warn") && !!item.entry.stack;

  const spine = isActive ? "border-l-primary" : "border-l-border";
  const fill = timelineFillClass(item);

  return (
    <div
      data-testid="timeline-row"
      data-kind={item.kind}
      data-active={isActive || undefined}
      className={`cursor-pointer border-l-4 ${spine} ${fill}`}
      aria-current={isActive ? "true" : undefined}
      onClick={() => onActivate(item)}
    >
      <div className="flex items-center gap-3 px-2.5 py-2 text-[13px] hover:bg-accent/50">
        <LogSeekChip ts={item.absTs} label={formatRelativeTime(item.absTs, videoStartedAt)} onSeek={() => onActivate(item)} />

        {item.kind === "action" && (
          <>
            <KindIcon kind={item.entry.kind} />
            <span className="min-w-0 flex-1 truncate font-mono text-mono">{renderActionContent(t, item.entry)}</span>
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
            {/* action "Clicked {}"처럼 method를 자연어 동사로 조립. 동사는 foreground mono,
                경로 슬롯은 action log URL처럼 파랑+밑줄 링크 표현이나 <a>가 아니라 클릭은 행
                activation(URL 이동 아님)으로 흐른다. raw method 색은 우측 sans 메타에만 준다. */}
            <span className="min-w-0 flex-1 truncate font-mono text-mono">
              {splitTemplate(t(`timeline.net.verb.${netVerbKey(item.req)}`)).map((tok, i) =>
                tok.type === "slot" ? (
                  <span key={i} className={`${TONE_TEXT.blue} underline`}>{networkLogPath(item.req.url)}</span>
                ) : (
                  <Fragment key={i}>{tok.value}</Fragment>
                ),
              )}
            </span>
            <span data-testid="timeline-net-meta" className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <span className={methodColor(item.req.method)}>{item.req.method}</span>
              <span className={isNetworkError(item.req) ? TONE_TEXT.red : undefined}>{statusLabel(item.req)}</span>
              {!isNetworkPending(item.req) && <span>{item.req.durationMs}ms</span>}
            </span>
          </>
        )}
      </div>

      {item.kind === "console" && canExpand && expanded && (
        // 스택은 메시지 텍스트 시작점(pl-[82px] = px-2.5 10 + chip 32 + gap 12 + icon 16 + gap 12)에 정렬.
        <div className="px-2.5 pb-2 pl-[82px] text-xs">
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-mono">
            <LinkifiedText text={item.entry.stack!} />
          </pre>
        </div>
      )}
    </div>
  );
});
