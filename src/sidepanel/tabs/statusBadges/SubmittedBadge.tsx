import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore, jiraSiteId } from "@/store/settings-store";
import type { JiraIssueStatus } from "@/types/jira";
import type { GithubIssueStatus } from "@/types/github";
import type { LinearIssueStatus } from "@/types/linear";
import type { NotionPageStatus } from "@/types/notion";
import type { PlatformId } from "@/types/platform";
import { sendBg } from "@/types/messages";
import { resolveGithubCoords, resolveNotionPageId } from "../issueListUtils";
import { notionStatusCategory } from "../notionStatusColors";
import {
  LINEAR_STATE_I18N,
  LINEAR_STATE_TYPE_COLORS,
  STATUS_CATEGORY_COLORS,
} from "./constants";
import { GithubStatusBadge, type GithubBadgeStatus } from "./GithubStatusBadge";
import { JiraStatusBadge } from "./JiraStatusBadge";
import { LinearStatusBadge } from "./LinearStatusBadge";
import { NotionStatusBadge } from "./NotionStatusBadge";

export function SubmittedBadge({
  issueId,
  issueKey,
  issueSiteId,
  issueUrl,
  platform,
  githubOwner,
  githubRepo,
  linearIdentifier,
  notionPageId,
  notionDatabaseId,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  issueKey: string;
  issueSiteId?: string;
  issueUrl?: string;
  platform: PlatformId;
  githubOwner?: string;
  githubRepo?: string;
  linearIdentifier?: string;
  notionPageId?: string;
  notionDatabaseId?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const ghAccount = useSettingsStore((s) => s.accounts.github);
  const linearAccount = useSettingsStore((s) => s.accounts.linear);
  const notionAccount = useSettingsStore((s) => s.accounts.notion);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const currentSiteId = jiraAccount?.auth ? jiraSiteId(jiraAccount.auth) : null;
  const siteMatch = !issueSiteId || currentSiteId === issueSiteId;
  const [jiraStatus, setJiraStatus] = useState<JiraIssueStatus | "error" | null>(null);
  const [ghStatus, setGhStatus] = useState<GithubBadgeStatus | "error" | null>(null);
  const [linearStatus, setLinearStatus] = useState<LinearIssueStatus | "error" | null>(null);
  const [notionStatus, setNotionStatus] = useState<NotionPageStatus | "error" | null>(null);

  const ghCoords = useMemo(
    () => resolveGithubCoords({ githubOwner, githubRepo, key: issueKey, url: issueUrl }),
    [githubOwner, githubRepo, issueKey, issueUrl],
  );

  useEffect(() => {
    if (platform === "jira") {
      if (!jiraAccount?.auth || !siteMatch) { setJiraStatus("error"); onLoaded(); return; }
      sendBg<JiraIssueStatus>({ type: "jira.getIssueStatus", issueKey })
        .then((res) => {
          setJiraStatus(res);
          const patch: Record<string, string> = {};
          if (res.issueTypeName) patch.issueTypeName = res.issueTypeName;
          if (res.summary) patch.title = res.summary;
          if (Object.keys(patch).length) patchIssue(issueId, patch);
        })
        .catch(() => setJiraStatus("error"))
        .finally(onLoaded);
      return;
    }
    if (platform === "github") {
      if (!ghAccount || !ghCoords) {
        setGhStatus("error"); onLoaded(); return;
      }
      sendBg<GithubIssueStatus>({
        type: "github.getIssueStatus",
        owner: ghCoords.owner,
        repo: ghCoords.repo,
        number: ghCoords.number,
      })
        .then((res) => {
          setGhStatus(
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
        .catch(() => setGhStatus("error"))
        .finally(onLoaded);
      return;
    }
    if (platform === "linear") {
      const identifier = linearIdentifier ?? issueKey;
      if (!linearAccount?.auth || !identifier) {
        setLinearStatus("error"); onLoaded(); return;
      }
      sendBg<LinearIssueStatus>({ type: "linear.getIssueStatus", issueId: identifier })
        .then((res) => {
          setLinearStatus(res);
          const patch: Partial<IssueRecord> = {};
          if (res.title) patch.title = res.title;
          if (res.identifier) patch.linearIdentifier = res.identifier;
          if (res.labels.length > 0) patch.linearLabelName = res.labels[0].name;
          if (Object.keys(patch).length) patchIssue(issueId, patch);
        })
        .catch(() => setLinearStatus("error"))
        .finally(onLoaded);
      return;
    }
    if (platform === "notion") {
      const pageId =
        resolveNotionPageId({ notionPageId, url: issueUrl }) ?? null;
      if (!notionAccount?.auth || !pageId) {
        setNotionStatus("error"); onLoaded(); return;
      }
      sendBg<NotionPageStatus>({ type: "notion.getPageStatus", pageId })
        .then((res) => {
          setNotionStatus(res);
          const patch: Partial<IssueRecord> = {};
          if (res.title) patch.title = res.title;
          if (!notionPageId) patch.notionPageId = res.pageId;
          if (res.statusOption) patch.notionStatusOption = res.statusOption.name;
          if (Object.keys(patch).length) patchIssue(issueId, patch);
        })
        .catch(() => setNotionStatus("error"))
        .finally(onLoaded);
      return;
    }
    onLoaded();
  }, [platform, jiraAccount?.auth, ghAccount, linearAccount?.auth, notionAccount?.auth, issueKey, issueUrl, ghCoords, linearIdentifier, notionPageId, refreshKey, siteMatch, onLoaded, issueId, patchIssue]);

  if (platform === "jira") {
    if (jiraStatus === "error") {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.unknown")}
        </Badge>
      );
    }
    if (!jiraStatus) return null;
    if (jiraAccount?.auth && siteMatch) {
      return (
        <JiraStatusBadge
          issueKey={issueKey}
          issueId={issueId}
          currentStatus={jiraStatus}
          onStatusChanged={setJiraStatus}
        />
      );
    }
    const colors = STATUS_CATEGORY_COLORS[jiraStatus.categoryKey] ?? STATUS_CATEGORY_COLORS.new;
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
      >
        {jiraStatus.name}
      </Badge>
    );
  }

  if (platform === "github") {
    if (ghStatus === "error") {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.unknown")}
        </Badge>
      );
    }
    if (!ghStatus) {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.submitted")}
        </Badge>
      );
    }
    if (ghCoords) {
      return (
        <GithubStatusBadge
          ghStatus={ghStatus}
          issueId={issueId}
          owner={ghCoords.owner}
          repo={ghCoords.repo}
          number={ghCoords.number}
          onStatusChanged={setGhStatus}
        />
      );
    }
    const ghLabel =
      ghStatus.kind === "open"
        ? t("issueList.github.open")
        : ghStatus.reason === "not_planned"
          ? t("issueList.github.notPlanned")
          : t("issueList.github.closed");
    const ghColors =
      ghStatus.kind === "open"
        ? STATUS_CATEGORY_COLORS.indeterminate
        : ghStatus.reason === "not_planned"
          ? STATUS_CATEGORY_COLORS.new
          : STATUS_CATEGORY_COLORS.done;
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 border-transparent text-[11px] ${ghColors.bg} ${ghColors.text} ${ghColors.darkBg} ${ghColors.darkText}`}
      >
        {ghLabel}
      </Badge>
    );
  }

  if (platform === "linear") {
    if (linearStatus === "error") {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.unknown")}
        </Badge>
      );
    }
    if (!linearStatus) {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.submitted")}
        </Badge>
      );
    }
    if (linearAccount?.auth && linearStatus.id) {
      return (
        <LinearStatusBadge
          issueId={linearStatus.id}
          issueIdentifier={linearStatus.identifier}
          currentState={linearStatus.state}
          onStatusChanged={setLinearStatus}
        />
      );
    }
    const stateType = linearStatus.state.type;
    const linearColors = LINEAR_STATE_TYPE_COLORS[stateType] ?? STATUS_CATEGORY_COLORS.new;
    const i18nKey = LINEAR_STATE_I18N[stateType] as Parameters<typeof t>[0] | undefined;
    const linearLabel = i18nKey ? t(i18nKey) : linearStatus.state.name;
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 border-transparent text-[11px] ${linearColors.bg} ${linearColors.text} ${linearColors.darkBg} ${linearColors.darkText}`}
      >
        {linearLabel}
      </Badge>
    );
  }

  if (platform === "notion") {
    if (notionStatus === "error") {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.unknown")}
        </Badge>
      );
    }
    if (!notionStatus) {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.submitted")}
        </Badge>
      );
    }
    if (notionStatus.statusOption) {
      const resolvedPageId = resolveNotionPageId({ notionPageId, url: issueUrl }) ?? null;
      if (notionAccount?.auth && notionDatabaseId && resolvedPageId) {
        return (
          <NotionStatusBadge
            pageId={resolvedPageId}
            databaseId={notionDatabaseId}
            issueId={issueId}
            currentOption={notionStatus.statusOption}
            onStatusChanged={setNotionStatus}
          />
        );
      }
      const category = notionStatusCategory(notionStatus.statusOption.color);
      const notionColors = STATUS_CATEGORY_COLORS[category];
      return (
        <Badge
          variant="outline"
          className={`w-fit shrink-0 border-transparent text-[11px] ${notionColors.bg} ${notionColors.text} ${notionColors.darkBg} ${notionColors.darkText}`}
        >
          {notionStatus.statusOption.name}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.notion.noStatus")}
      </Badge>
    );
  }

  return null;
}
