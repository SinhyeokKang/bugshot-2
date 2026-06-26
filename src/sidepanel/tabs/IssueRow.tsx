import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "@/i18n";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { PlatformChip } from "./statusBadges/PlatformChip";
import { SubmittedBadge } from "./statusBadges/SubmittedBadge";
import { formatDate, formatIssueKey, issueTimestamp } from "./issueListUtils";

export function IssueRow({
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
  const t = useT();
  const isSubmitted = issue.status === "submitted" && !!issue.url;
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const [badgeHover, setBadgeHover] = useState(false);

  const textMetaParts: string[] = [];
  if (isSubmitted) {
    textMetaParts.push(formatDate(issueTimestamp(issue), t));
    if (issue.key) textMetaParts.push(formatIssueKey(issue));
  } else {
    textMetaParts.push(t("issueList.draft"));
    textMetaParts.push(formatDate(issueTimestamp(issue), t));
  }

  const handleCardClick = () => {
    if (isSubmitted) {
      chrome.tabs.create({ url: issue.url!, active: true });
    } else {
      // Card는 비포커서블이라 직전 포커스(탭 trigger 등)가 그대로 남는다.
      // Radix Dialog가 root에 aria-hidden을 씌우면 포커스된 후손이 있어
      // 브라우저 a11y 경고가 뜨므로, 미리 blur해서 경고를 막는다.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      onOpenDraft();
    }
  };

  return (
    <li>
      <Card
        className={`group cursor-pointer transition-colors ${badgeHover ? "" : "hover:bg-muted/50"}`}
        onClick={handleCardClick}
        data-testid="issue-row"
        data-status={issue.status}
      >
        <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">
              {issue.title || t("common.untitled")}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              {isSubmitted ? (
                <>
                  <PlatformChip platform={issue.platform} />
                  {textMetaParts.length > 0 ? <span aria-hidden>·</span> : null}
                </>
              ) : null}
              <span className="min-w-0 truncate">{textMetaParts.join(" · ")}</span>
            </span>
          </div>
          {isSubmitted && issue.key ? (
            <span
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={() => setBadgeHover(true)}
              onMouseLeave={() => setBadgeHover(false)}
            >
              <SubmittedBadge
                issueId={issue.id}
                issueKey={issue.key}
                issueSiteId={issue.jiraSiteId}
                issueUrl={issue.url}
                platform={issue.platform}
                githubOwner={issue.githubOwner}
                githubRepo={issue.githubRepo}
                linearIdentifier={issue.linearIdentifier}
                notionPageId={issue.notionPageId}
                notionDatabaseId={issue.notionDatabaseId}
                gitlabProjectId={issue.gitlabProjectId}
                gitlabIssueIid={issue.gitlabIssueIid}
                asanaTaskGid={issue.asanaTaskGid}
                clickupTaskId={issue.clickupTaskId}
                refreshKey={refreshKey}
                onLoaded={onBadgeLoaded}
              />
            </span>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={t("issueList.deleteDraft.title")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("issueList.deleteDraft.title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("issueList.deleteDraft.body")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => removeIssue(issue.id)}
                  >
                    {t("issueList.deleteIssue")}
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
