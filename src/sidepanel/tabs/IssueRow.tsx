import { useState } from "react";
import { Eye, Send, Trash2 } from "lucide-react";
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
import { ButtonGroup } from "@/components/ui/button-group";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import { PlatformChip } from "./statusBadges/PlatformChip";
import { SubmittedBadge } from "./statusBadges/SubmittedBadge";
import { canPromoteSlack, formatDate, formatIssueKey, issueTimestamp } from "./issueListUtils";

export function IssueRow({
  issue,
  refreshKey,
  onOpenDraft,
  onOpenSubmit,
  onBadgeLoaded,
}: {
  issue: IssueRecord;
  refreshKey: number;
  onOpenDraft: () => void;
  onOpenSubmit: () => void;
  onBadgeLoaded: () => void;
}) {
  const t = useT();
  const isSubmitted = issue.status === "submitted" && !!issue.url;
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const accounts = useSettingsStore((s) => s.accounts);
  const promotable = canPromoteSlack(issue, accounts);
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
    <div
      className={`group flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors ${badgeHover ? "" : "hover:bg-muted/50"}`}
      onClick={handleCardClick}
      data-testid="issue-row"
      data-status={issue.status}
    >
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
      {promotable ? (
        <ButtonGroup className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t("issueList.viewDetail")}
            title={t("issueList.viewDetail")}
            data-testid="view-detail-issue"
            onClick={onOpenDraft}
          >
            <Eye />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t("issueList.promote")}
            title={t("issueList.promote")}
            data-testid="promote-issue"
            onClick={onOpenSubmit}
          >
            <Send />
          </Button>
        </ButtonGroup>
      ) : isSubmitted && issue.key ? (
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
    </div>
  );
}
