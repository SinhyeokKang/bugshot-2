import type { PlatformId } from "@/types/platform";
import { GithubSubmittedBadge } from "./GithubSubmittedBadge";
import { JiraSubmittedBadge } from "./JiraSubmittedBadge";
import { LinearSubmittedBadge } from "./LinearSubmittedBadge";
import { NotionSubmittedBadge } from "./NotionSubmittedBadge";

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
  if (platform === "jira") {
    return (
      <JiraSubmittedBadge
        issueId={issueId}
        issueKey={issueKey}
        issueSiteId={issueSiteId}
        refreshKey={refreshKey}
        onLoaded={onLoaded}
      />
    );
  }
  if (platform === "github") {
    return (
      <GithubSubmittedBadge
        issueId={issueId}
        issueKey={issueKey}
        issueUrl={issueUrl}
        githubOwner={githubOwner}
        githubRepo={githubRepo}
        refreshKey={refreshKey}
        onLoaded={onLoaded}
      />
    );
  }
  if (platform === "linear") {
    return (
      <LinearSubmittedBadge
        issueId={issueId}
        issueKey={issueKey}
        linearIdentifier={linearIdentifier}
        refreshKey={refreshKey}
        onLoaded={onLoaded}
      />
    );
  }
  if (platform === "notion") {
    return (
      <NotionSubmittedBadge
        issueId={issueId}
        issueUrl={issueUrl}
        notionPageId={notionPageId}
        notionDatabaseId={notionDatabaseId}
        refreshKey={refreshKey}
        onLoaded={onLoaded}
      />
    );
  }
  return null;
}
