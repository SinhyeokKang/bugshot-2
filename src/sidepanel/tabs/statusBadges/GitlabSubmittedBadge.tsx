import { useEffect, useMemo, useState } from "react";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { GitlabIssueStatus } from "@/types/gitlab";
import { sendBg } from "@/lib/bg-client";
import { classifyBadgeError, type BadgeErrorKind } from "./utils";
import { resolveGitlabCoords } from "@/sidepanel/tabs/issueListUtils";
import { BadgeFallback } from "./BadgeFallback";
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
    return <BadgeFallback kind={status} />;
  }
  if (!status) return <BadgeFallback kind="loading" />;
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
