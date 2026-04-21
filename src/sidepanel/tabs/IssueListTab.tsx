import { useMemo } from "react";
import { ExternalLink, FileEdit, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { PageScroll, PageShell, Section } from "../components/Section";

export function IssueListTab() {
  const issues = useIssuesStore((s) => s.issues);

  const sorted = useMemo(
    () => [...issues].sort((a, b) => b.createdAt - a.createdAt),
    [issues],
  );

  if (sorted.length === 0) {
    return (
      <PageShell>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground/60">
          <Inbox className="h-9 w-9" strokeWidth={1.5} />
          <span className="text-lg font-medium">등록한 이슈가 없습니다</span>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageScroll>
        <Section title="이슈 목록">
          <ul className="flex flex-col gap-2">
            {sorted.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        </Section>
      </PageScroll>
    </PageShell>
  );
}

function IssueRow({ issue }: { issue: IssueRecord }) {
  const isSubmitted = issue.status === "submitted" && !!issue.url;

  const handleClick = () => {
    if (isSubmitted && issue.url) {
      chrome.tabs.create({ url: issue.url, active: true });
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        disabled={!isSubmitted}
        className={cn(
          "group flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-background px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isSubmitted ? "hover:bg-muted/50" : "cursor-default",
        )}
      >
        <div className="flex items-center gap-2">
          <StatusBadge issue={issue} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {issue.title || "(제목 없음)"}
          </span>
          {isSubmitted ? (
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{formatDate(issue.createdAt)}</span>
          {issue.issueTypeName ? (
            <>
              <span>·</span>
              <span>{issue.issueTypeName}</span>
            </>
          ) : null}
          {issue.priorityName ? (
            <>
              <span>·</span>
              <span>{issue.priorityName}</span>
            </>
          ) : null}
          {issue.assigneeName ? (
            <>
              <span>·</span>
              <span className="truncate">{issue.assigneeName}</span>
            </>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function StatusBadge({ issue }: { issue: IssueRecord }) {
  if (issue.status === "submitted" && issue.key) {
    return (
      <span className="shrink-0 rounded bg-muted px-1.5 py-[1px] font-mono text-[11px] text-foreground">
        {issue.key}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-[1px] text-[11px] font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      <FileEdit className="h-3 w-3" />
      초안
    </span>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
