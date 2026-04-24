import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileEdit, Inbox, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import {
  isJiraConfigComplete,
  useSettingsStore,
} from "@/store/settings-store";
import type { JiraIssueStatus } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { PageScroll, PageShell, Section } from "../components/Section";
import { DraftDetailDialog } from "./DraftDetailDialog";

export function IssueListTab() {
  const issues = useIssuesStore((s) => s.issues);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const sorted = useMemo(
    () =>
      issues
        .filter(
          (i) => i.status === "submitted" || !!i.selectionSnapshot,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [issues],
  );

  const activeDraft = useMemo(
    () => (draftId ? issues.find((i) => i.id === draftId) ?? null : null),
    [issues, draftId],
  );

  if (sorted.length === 0) {
    return (
      <PageShell>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-[18px] font-semibold">등록한 이슈가 없습니다</h3>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageScroll>
        <Section
          title="이슈 목록"
          action={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          }
        >
          <ul className="flex flex-col gap-2">
            {sorted.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                refreshKey={refreshKey}
                onOpenDraft={() => setDraftId(issue.id)}
              />
            ))}
          </ul>
        </Section>
      </PageScroll>
      <DraftDetailDialog
        issue={activeDraft}
        open={!!activeDraft}
        onOpenChange={(v) => !v && setDraftId(null)}
      />
    </PageShell>
  );
}

function IssueRow({
  issue,
  refreshKey,
  onOpenDraft,
}: {
  issue: IssueRecord;
  refreshKey: number;
  onOpenDraft: () => void;
}) {
  const isSubmitted = issue.status === "submitted" && !!issue.url;
  const removeIssue = useIssuesStore((s) => s.removeIssue);

  const metaParts: string[] = [];
  if (isSubmitted && issue.key) metaParts.push(issue.key);
  metaParts.push(formatDate(issue.createdAt));
  if (issue.issueTypeName) metaParts.push(issue.issueTypeName);
  if (issue.priorityName) metaParts.push(issue.priorityName);
  if (issue.assigneeName) metaParts.push(issue.assigneeName);

  const handleCardClick = () => {
    if (!isSubmitted) onOpenDraft();
  };

  return (
    <li>
      <Card
        className={`group transition-colors hover:bg-muted/50 ${!isSubmitted ? "cursor-pointer" : ""}`}
        onClick={handleCardClick}
      >
        <CardContent className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <StatusBadge issue={issue} refreshKey={refreshKey} />
            <span className="truncate text-base font-medium text-foreground">
              {issue.title || "(제목 없음)"}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {metaParts.join(" · ")}
            </span>
          </div>
          {isSubmitted ? (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() =>
                chrome.tabs.create({ url: issue.url!, active: true })
              }
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                removeIssue(issue.id);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

const STATUS_CATEGORY_COLORS: Record<
  string,
  { bg: string; text: string; darkBg: string; darkText: string }
> = {
  new: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    darkBg: "dark:bg-slate-500/15",
    darkText: "dark:text-slate-300",
  },
  indeterminate: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    darkBg: "dark:bg-blue-500/15",
    darkText: "dark:text-blue-300",
  },
  done: {
    bg: "bg-green-100",
    text: "text-green-700",
    darkBg: "dark:bg-green-500/15",
    darkText: "dark:text-green-300",
  },
};

function StatusBadge({ issue, refreshKey }: { issue: IssueRecord; refreshKey: number }) {
  if (issue.status === "submitted" && issue.key) {
    return <SubmittedBadge issueKey={issue.key} refreshKey={refreshKey} />;
  }
  return (
    <Badge className="w-fit shrink-0 gap-1 border-transparent bg-amber-100 text-[11px] text-amber-900 shadow-none dark:bg-amber-500/15 dark:text-amber-200">
      <FileEdit className="h-3 w-3" />
      초안
    </Badge>
  );
}

function SubmittedBadge({ issueKey, refreshKey }: { issueKey: string; refreshKey: number }) {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const configured = isJiraConfigComplete(jiraConfig);
  const [status, setStatus] = useState<JiraIssueStatus | null>(null);

  useEffect(() => {
    if (!configured || !jiraConfig?.auth) return;
    sendBg<JiraIssueStatus>({
      type: "jira.getIssueStatus",
      config: jiraConfig.auth,
      issueKey,
    })
      .then(setStatus)
      .catch(() => {});
  }, [configured, jiraConfig?.auth, issueKey, refreshKey]);

  const colors = status
    ? STATUS_CATEGORY_COLORS[status.categoryKey] ??
      STATUS_CATEGORY_COLORS.new
    : null;

  if (!status || !colors) return null;

  return (
    <Badge
      className={`w-fit shrink-0 border-transparent text-[11px] shadow-none ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
    >
      {status.name}
    </Badge>
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
