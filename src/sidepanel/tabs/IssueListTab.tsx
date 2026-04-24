import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CircleCheck, Inbox, Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore, jiraSiteId } from "@/store/settings-store";
import type { JiraIssueStatus } from "@/types/jira";
import { sendBg, type JiraSubmitResult } from "@/types/messages";
import { PageFooter, PageScroll, PageShell, Section } from "../components/Section";
import { DraftDetailDialog } from "./DraftDetailDialog";

export function IssueListTab() {
  const issues = useIssuesStore((s) => s.issues);
  const clearIssues = useIssuesStore((s) => s.clearIssues);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pendingRef = useRef(0);
  const [successResult, setSuccessResult] = useState<JiraSubmitResult | null>(null);

  const sorted = useMemo(
    () =>
      issues
        .filter(
          (i) => i.status === "submitted" || !!i.selectionSnapshot || i.captureMode === "screenshot",
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [issues],
  );

  const submittedCount = useMemo(
    () => sorted.filter((i) => i.status === "submitted" && !!i.url && !!i.key).length,
    [sorted],
  );

  const handleRefresh = useCallback(() => {
    if (submittedCount === 0) {
      setRefreshKey((k) => k + 1);
      return;
    }
    pendingRef.current = submittedCount;
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
  }, [submittedCount]);

  const handleBadgeLoaded = useCallback(() => {
    pendingRef.current -= 1;
    if (pendingRef.current <= 0) setIsRefreshing(false);
  }, []);

  const activeDraft = useMemo(
    () => (draftId ? issues.find((i) => i.id === draftId) ?? null : null),
    [issues, draftId],
  );

  if (successResult) {
    return (
      <PageShell>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <CircleCheck className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="text-[18px] font-semibold">이슈가 제출되었습니다</h3>
          <a
            href={successResult.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {successResult.key}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <div className="mt-6">
            <Button variant="outline" onClick={() => setSuccessResult(null)}>
              확인
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

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
        {groupByDate(sorted).map(([date, group]) => (
          <Section key={date} title={date} collapsible>
            <ul className="flex flex-col gap-2">
              {group.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  refreshKey={refreshKey}
                  onOpenDraft={() => setDraftId(issue.id)}
                  onBadgeLoaded={handleBadgeLoaded}
                />
              ))}
            </ul>
          </Section>
        ))}
      </PageScroll>
      <PageFooter>
        <div className="flex justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive">
                모두 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>모든 이슈를 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  등록된 이슈 목록이 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>닫기</AlertDialogCancel>
                <AlertDialogAction onClick={clearIssues}>
                  모두 삭제
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="outline"
            disabled={isRefreshing}
            onClick={handleRefresh}
            className="relative"
          >
            {isRefreshing && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={isRefreshing ? "opacity-0" : undefined}>
              목록 새로고침
            </span>
          </Button>
        </div>
      </PageFooter>
      <DraftDetailDialog
        issue={activeDraft}
        open={!!activeDraft}
        onOpenChange={(v) => !v && setDraftId(null)}
        onSubmitSuccess={(result) => {
          setDraftId(null);
          setSuccessResult(result);
        }}
      />
    </PageShell>
  );
}

function IssueRow({
  issue,
  refreshKey,
  onOpenDraft,
  onBadgeLoaded,
}: {
  issue: IssueRecord;
  refreshKey: number;
  onOpenDraft: () => void;
  onBadgeLoaded: () => void;
}) {
  const isSubmitted = issue.status === "submitted" && !!issue.url;
  const removeIssue = useIssuesStore((s) => s.removeIssue);

  const metaParts: string[] = [];
  metaParts.push(formatDate(issue.createdAt));
  if (isSubmitted && issue.url) {
    try { metaParts.push(new URL(issue.url).hostname); } catch {}
  }
  if (isSubmitted && issue.key) metaParts.push(`[${issue.key}]`);
  if (!isSubmitted) metaParts.push("초안");
  if (issue.issueTypeName) metaParts.push(issue.issueTypeName);
  if (issue.priorityName) metaParts.push(issue.priorityName);
  if (issue.assigneeName) metaParts.push(issue.assigneeName);

  const handleCardClick = () => {
    if (isSubmitted) {
      chrome.tabs.create({ url: issue.url!, active: true });
    } else {
      onOpenDraft();
    }
  };

  return (
    <li>
      <Card
        className="group cursor-pointer transition-colors hover:bg-muted/50"
        onClick={handleCardClick}
      >
        <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">
              {issue.title || "(제목 없음)"}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {metaParts.join(" · ")}
            </span>
          </div>
          {isSubmitted && issue.key ? (
            <SubmittedBadge issueKey={issue.key} issueSiteId={issue.jiraSiteId} refreshKey={refreshKey} onLoaded={onBadgeLoaded} />
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>초안을 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>
                    삭제된 초안은 복구할 수 없습니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>닫기</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => removeIssue(issue.id)}
                  >
                    이슈 삭제
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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


function SubmittedBadge({ issueKey, issueSiteId, refreshKey, onLoaded }: { issueKey: string; issueSiteId?: string; refreshKey: number; onLoaded: () => void }) {
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const currentSiteId = jiraConfig?.auth ? jiraSiteId(jiraConfig.auth) : null;
  const siteMatch = !issueSiteId || currentSiteId === issueSiteId;
  const [status, setStatus] = useState<JiraIssueStatus | "error" | null>(null);

  useEffect(() => {
    if (!jiraConfig?.auth || !siteMatch) { setStatus("error"); onLoaded(); return; }
    sendBg<JiraIssueStatus>({
      type: "jira.getIssueStatus",
      config: jiraConfig.auth,
      issueKey,
    })
      .then(setStatus)
      .catch(() => setStatus("error"))
      .finally(onLoaded);
  }, [jiraConfig?.auth, issueKey, refreshKey, siteMatch, onLoaded]);

  if (status === "error") {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        알 수 없음
      </Badge>
    );
  }

  const colors = status
    ? STATUS_CATEGORY_COLORS[status.categoryKey] ??
      STATUS_CATEGORY_COLORS.new
    : null;

  if (!status || !colors) return null;

  return (
    <Badge
      variant="outline"
      className={`w-fit shrink-0 border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
    >
      {status.name}
    </Badge>
  );
}

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return dateLabel(ts);
}

function groupByDate(issues: IssueRecord[]): [string, IssueRecord[]][] {
  const groups = new Map<string, IssueRecord[]>();
  for (const issue of issues) {
    const key = dateLabel(issue.createdAt);
    const list = groups.get(key);
    if (list) list.push(issue);
    else groups.set(key, [issue]);
  }
  return Array.from(groups);
}
