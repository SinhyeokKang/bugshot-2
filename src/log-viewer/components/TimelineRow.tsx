import { memo, Fragment } from "react";
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
import { netVerbKey, timelineFillClass, type TimelineItem } from "../timeline-merge";

type NetworkReq = Extract<TimelineItem, { kind: "network" }>["req"];

interface TimelineRowProps {
  item: TimelineItem;
  isActive: boolean;
  videoStartedAt: number;
  // 행 클릭: 영상 seek + 해당 로그 탭 조회를 동시 발화(App에서 배선).
  onActivate: (item: TimelineItem) => void;
}

function statusLabel(req: NetworkReq): string {
  if (isNetworkPending(req)) return "···";
  if (isStatusHidden(req) || req.status <= 0) return "—";
  return String(req.status);
}

// 1행 1이벤트 렌더. 기존 로그 행처럼 컨테이너는 div(중첩 button 무효 HTML 회피) —
// 행 클릭=activate(seek+탭 조회), 내부 seek 칩만 focus 가능한 button으로 분리.
// 상세(args 전문·스택·pageUrl)는 행이 아니라 우측 콘솔 탭이 담당한다 — activate가
// seek과 함께 탭 전환 + scrollToEntryId를 발화하므로 행 자체 펼침은 중복이다.
export const TimelineRow = memo(function TimelineRow({
  item,
  isActive,
  videoStartedAt,
  onActivate,
}: TimelineRowProps) {
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
            <KindIcon kind={item.entry.kind} navType={item.entry.navType} />
            <span className="min-w-0 flex-1 truncate font-mono text-mono">{renderActionContent(t, item.entry)}</span>
          </>
        )}

        {item.kind === "console" && (
          <>
            <LevelIcon level={item.entry.level} />
            <span className="min-w-0 flex-1 break-all font-mono text-mono">
              <LinkifiedText text={item.entry.args} />
            </span>
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
    </div>
  );
});
