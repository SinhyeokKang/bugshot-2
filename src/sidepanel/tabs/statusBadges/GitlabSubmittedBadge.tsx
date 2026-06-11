import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { GitlabIssueStatus } from "@/types/gitlab";
import { sendBg } from "@/types/messages";
import { classifyBadgeError, type BadgeErrorKind } from "./utils";
import { resolveGitlabCoords } from "@/sidepanel/tabs/issueListUtils";
import { STATUS_CATEGORY_COLORS } from "./constants";
import { GitlabStatusBadge, type GitlabBadgeStatus } from "./GitlabStatusBadge";

export function GitlabSubmittedBadge({
  issueId,
  issueKey,
  gitlabProjectId,
  gitlabIssueIid,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  issueKey: string;
  gitlabProjectId?: number;
  gitlabIssueIid?: number;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const gitlabAccount = useSettingsStore((s) => s.accounts.gitlab);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [status, setStatus] = useState<GitlabBadgeStatus | BadgeErrorKind | null>(null);

  const glCoords = useMemo(
    () => resolveGitlabCoords({ gitlabProjectId, gitlabIssueIid, key: issueKey }),
    [gitlabProjectId, gitlabIssueIid, issueKey],
  );

  useEffect(() => {
    if (!gitlabAccount || !glCoords) {
      setStatus("error");
      onLoaded();
      return;
    }
    sendBg<GitlabIssueStatus>({
      type: "gitlab.getIssueStatus",
      projectId: glCoords.projectId,
      iid: glCoords.iid,
    })
      .then((res) => {
        setStatus({ kind: res.state });
        const patch: Partial<IssueRecord> = {};
        if (res.title) patch.title = res.title;
        patch.gitlabLabels = res.labels.filter(Boolean);
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch((err) => setStatus(classifyBadgeError(err)))
      .finally(onLoaded);
  }, [gitlabAccount, glCoords, refreshKey, onLoaded, issueId, patchIssue]);

  if (status === "error" || status === "deleted") {
    const deleted = status === "deleted";
    const colors = deleted ? STATUS_CATEGORY_COLORS.deleted : undefined;
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 text-[11px] ${colors ? `border-transparent ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}` : ""}`}
      >
        {t(deleted ? "issueList.deleted" : "issueList.unknown")}
      </Badge>
    );
  }
  if (!status) {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.submitted")}
      </Badge>
    );
  }
  return (
    <GitlabStatusBadge
      glStatus={status}
      issueId={issueId}
      projectId={glCoords!.projectId}
      iid={glCoords!.iid}
      onStatusChanged={setStatus}
    />
  );
}
