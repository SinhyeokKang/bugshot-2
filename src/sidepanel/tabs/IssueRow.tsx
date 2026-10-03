import { readSubmissionRecovery } from "@/store/blob-db";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, FileText, Trash2, Upload } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ButtonGroup } from "@/components/ui/button-group";
import { isSlackPreserved, useIssuesStore, type IssueRecord } from "@/store/issues-store";
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
  onOpenDraft: (recoveryTrigger?: HTMLButtonElement | null) => void;
  onOpenSubmit: () => void;
  onBadgeLoaded: () => void;
}) {
  const t = useT();
  const recoveryTrigger = useRef<HTMLButtonElement>(null);
  const recovering = !!issue.submissionRecoveryId;
  const isSubmitted = issue.status === "submitted" && (!!issue.url || recovering);
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const accounts = useSettingsStore((s) => s.accounts);
  const promotable = canPromoteSlack(issue, accounts);
  const [unknownCreation, setUnknownCreation] = useState(issue.status !== "submitted");
  const [localMissing, setLocalMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLocalMissing(false);
    setUnknownCreation(issue.status !== "submitted");
    if (issue.submissionRecoveryId) void readSubmissionRecovery(issue.id).then((meta) => {
      if (!cancelled && meta && meta.attemptId === issue.submissionRecoveryId) {
        setLocalMissing(!!meta.localFilesRemoved);
        setUnknownCreation(!meta.destination);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [issue, refreshKey]);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const hoverGuard = {
    onMouseEnter: () => setHoverSuppressed(true),
    onMouseLeave: () => setHoverSuppressed(false),
  };

  const textMetaParts: string[] = [];
  if (isSubmitted) {
    textMetaParts.push(formatDate(issueTimestamp(issue), t));
    if (issue.key) textMetaParts.push(formatIssueKey(issue));
  } else {
    textMetaParts.push(t("issueList.draft"));
    textMetaParts.push(formatDate(issueTimestamp(issue), t));
  }

  const handleCardClick = () => {
    if (isSubmitted && issue.url && !recovering) {
      chrome.tabs.create({ url: issue.url!, active: true });
    } else {
      // Card는 비포커서블이라 직전 포커스(탭 trigger 등)가 그대로 남는다.
      // Radix Dialog가 root에 aria-hidden을 씌우면 포커스된 후손이 있어
      // 브라우저 a11y 경고가 뜨므로, 미리 blur해서 경고를 막는다.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      onOpenDraft(recovering ? recoveryTrigger.current : undefined);
    }
  };

  return (
    <div
      className={`group flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors ${hoverSuppressed ? "" : "hover:bg-muted/50"}`}
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
        {recovering && <span className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400" data-testid="recovery-row-warning"><CircleAlert className="h-4 w-4 shrink-0" />{t(localMissing ? "recovery.localMissing" : unknownCreation ? "recovery.unknownWarning" : "recovery.needsAttention")}</span>}
      </div>
      {recovering ? (
        <ButtonGroup className="shrink-0" onClick={(e) => e.stopPropagation()} {...hoverGuard}>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("issueList.viewDetail")} ref={recoveryTrigger} data-testid="recovery-detail-open" onClick={handleCardClick}><FileText /></Button>
          {isSlackPreserved(issue) && <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:hover:text-foreground" aria-disabled aria-label={t("issueList.promote")} data-testid="promote-issue" onClick={() => {}}><Upload /></Button></TooltipTrigger><TooltipContent>{t("recovery.promotionBlocked")}</TooltipContent></Tooltip></TooltipProvider>}
        </ButtonGroup>
      ) : promotable ? (
        <ButtonGroup className="shrink-0" onClick={(e) => e.stopPropagation()} {...hoverGuard}>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t("issueList.viewDetail")}
            title={t("issueList.viewDetail")}
            data-testid="view-detail-issue"
            onClick={() => onOpenDraft()}
          >
            <FileText />
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
            <Upload />
          </Button>
        </ButtonGroup>
      ) : isSubmitted && issue.key ? (
        <span onClick={(e) => e.stopPropagation()} {...hoverGuard}>
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
              className="h-8 w-8 shrink-0 hover:text-destructive"
              aria-label={t("issueList.deleteDraft.title")}
              onClick={(e) => e.stopPropagation()}
              {...hoverGuard}
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
                onClick={() => { void removeIssue(issue.id).catch(() => toast.error(t("bg.error.unknown"))); }}
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
