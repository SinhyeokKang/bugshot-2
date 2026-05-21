import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { GithubIssueStatus } from "@/types/github";
import { sendBg } from "@/types/messages";
import { resolveGithubCoords } from "../issueListUtils";
import { STATUS_CATEGORY_COLORS } from "./constants";
import { GithubStatusBadge, type GithubBadgeStatus } from "./GithubStatusBadge";

export function GithubSubmittedBadge({
  issueId,
  issueKey,
  issueUrl,
  githubOwner,
  githubRepo,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  issueKey: string;
  issueUrl?: string;
  githubOwner?: string;
  githubRepo?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const ghAccount = useSettingsStore((s) => s.accounts.github);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [status, setStatus] = useState<GithubBadgeStatus | "error" | null>(null);

  const ghCoords = useMemo(
    () => resolveGithubCoords({ githubOwner, githubRepo, key: issueKey, url: issueUrl }),
    [githubOwner, githubRepo, issueKey, issueUrl],
  );

  useEffect(() => {
    if (!ghAccount || !ghCoords) {
      setStatus("error");
      onLoaded();
      return;
    }
    sendBg<GithubIssueStatus>({
      type: "github.getIssueStatus",
      owner: ghCoords.owner,
      repo: ghCoords.repo,
      number: ghCoords.number,
    })
      .then((res) => {
        setStatus(
          res.state === "open"
            ? { kind: "open" }
            : { kind: "closed", reason: res.stateReason ?? null },
        );
        const patch: Partial<IssueRecord> = {};
        if (res.title) patch.title = res.title;
        if (!githubOwner) patch.githubOwner = ghCoords.owner;
        if (!githubRepo) patch.githubRepo = ghCoords.repo;
        patch.githubLabels = res.labels.map((l) => l.name).filter(Boolean);
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch(() => setStatus("error"))
      .finally(onLoaded);
  }, [ghAccount, ghCoords, refreshKey, onLoaded, issueId, patchIssue, githubOwner, githubRepo]);

  if (status === "error") {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.unknown")}
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
  if (ghCoords) {
    return (
      <GithubStatusBadge
        ghStatus={status}
        issueId={issueId}
        owner={ghCoords.owner}
        repo={ghCoords.repo}
        number={ghCoords.number}
        onStatusChanged={setStatus}
      />
    );
  }
  const label =
    status.kind === "open"
      ? t("issueList.github.open")
      : status.reason === "not_planned"
        ? t("issueList.github.notPlanned")
        : t("issueList.github.closed");
  const colors =
    status.kind === "open"
      ? STATUS_CATEGORY_COLORS.indeterminate
      : status.reason === "not_planned"
        ? STATUS_CATEGORY_COLORS.new
        : STATUS_CATEGORY_COLORS.done;
  return (
    <Badge
      variant="outline"
      className={`w-fit shrink-0 border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
    >
      {label}
    </Badge>
  );
}
