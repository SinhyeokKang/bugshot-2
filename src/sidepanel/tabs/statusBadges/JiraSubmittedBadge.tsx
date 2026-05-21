import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore } from "@/store/issues-store";
import { useSettingsStore, jiraSiteId } from "@/store/settings-store";
import type { JiraIssueStatus } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { STATUS_CATEGORY_COLORS } from "./constants";
import { JiraStatusBadge } from "./JiraStatusBadge";

export function JiraSubmittedBadge({
  issueId,
  issueKey,
  issueSiteId,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  issueKey: string;
  issueSiteId?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const currentSiteId = jiraAccount?.auth ? jiraSiteId(jiraAccount.auth) : null;
  const siteMatch = !issueSiteId || currentSiteId === issueSiteId;
  const [status, setStatus] = useState<JiraIssueStatus | "error" | null>(null);

  useEffect(() => {
    if (!jiraAccount?.auth || !siteMatch) {
      setStatus("error");
      onLoaded();
      return;
    }
    sendBg<JiraIssueStatus>({ type: "jira.getIssueStatus", issueKey })
      .then((res) => {
        setStatus(res);
        const patch: Record<string, string> = {};
        if (res.issueTypeName) patch.issueTypeName = res.issueTypeName;
        if (res.summary) patch.title = res.summary;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch(() => setStatus("error"))
      .finally(onLoaded);
  }, [jiraAccount?.auth, issueKey, refreshKey, siteMatch, onLoaded, issueId, patchIssue]);

  if (status === "error") {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.unknown")}
      </Badge>
    );
  }
  if (!status) return null;
  if (jiraAccount?.auth && siteMatch) {
    return (
      <JiraStatusBadge
        issueKey={issueKey}
        issueId={issueId}
        currentStatus={status}
        onStatusChanged={setStatus}
      />
    );
  }
  const colors = STATUS_CATEGORY_COLORS[status.categoryKey] ?? STATUS_CATEGORY_COLORS.new;
  return (
    <Badge
      variant="outline"
      className={`w-fit shrink-0 border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
    >
      {status.name}
    </Badge>
  );
}
