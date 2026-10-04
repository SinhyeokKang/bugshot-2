import { attachmentAccountIdentity } from "@/lib/attachment-identity";
import {
  readStoredAuth,
  readStoredAsanaAuth,
  readStoredClickupAuth,
  readStoredGithubAuth,
  readStoredGitlabAuth,
  readStoredLinearAuth,
  readStoredNotionAuth,
  readStoredSlackAuth,
} from "@/lib/settings-storage";
import type { CreatedDestination, RetryPlatform } from "@/types/attachment";
import { JiraError, ensureFreshAuth, getMyself as jiraGetMyself } from "./jira-api";
import { GithubError, githubFetch } from "./github-api";
import { GitlabError, getMyself as gitlabGetMyself } from "./gitlab-api";
import { LinearError, getViewerIdentity as linearGetViewerIdentity } from "./linear-api";
import { NotionError, getBotIdentity as notionGetBotIdentity } from "./notion-api";
import { AsanaError, asanaFetch, getMyself as asanaGetMyself } from "./asana-api";
import { ClickupError, clickupFetch, getMyself as clickupGetMyself } from "./clickup-api";
import { SlackError, getMyself as slackGetMyself } from "./slack-api";

const NOT_CONNECTED = "Platform is not connected";
// A platform error so the 401 + code survive the message boundary: the retry shows reconnect
// guidance instead of the "unknown" a plain Error (indistinguishable from a network failure) gives.
const DISCONNECTED: Record<RetryPlatform, () => Error> = {
  jira: () => new JiraError(401, NOT_CONNECTED, { code: "not_connected" }),
  github: () => new GithubError(401, NOT_CONNECTED, { code: "not_connected" }),
  gitlab: () => new GitlabError(401, NOT_CONNECTED, { code: "not_connected" }),
  linear: () => new LinearError(401, NOT_CONNECTED, { code: "not_connected" }),
  notion: () => new NotionError(401, NOT_CONNECTED, { code: "not_connected" }),
  asana: () => new AsanaError(401, NOT_CONNECTED, { code: "not_connected" }),
  clickup: () => new ClickupError(401, NOT_CONNECTED, { code: "not_connected" }),
  slack: () => new SlackError("not_connected", NOT_CONNECTED, 401, { platform: "slack", code: "not_connected" }),
};

// Parts come from the *current* connection (site, base URL, account) plus the immutable
// destination where the scope is per-task, so a reconnect to another account never matches.
function connected<T>(platform: RetryPlatform, auth: T | null): T {
  if (!auth) throw DISCONNECTED[platform]();
  return auth;
}

async function identityParts(destination: Extract<CreatedDestination, { platform: RetryPlatform }>): Promise<Record<string, unknown>> {
  switch (destination.platform) {
    case "jira": {
      const auth = await ensureFreshAuth(connected("jira", await readStoredAuth()));
      const me = await jiraGetMyself(auth);
      return { siteId: auth.kind === "oauth" ? auth.cloudId : auth.baseUrl, accountId: me.accountId };
    }
    case "github": {
      // GET /user only — getMyself would also read /user/emails, which identity does not need.
      const me = await githubFetch<{ id?: number }>(connected("github", await readStoredGithubAuth()), "/user");
      return { userId: me.id };
    }
    case "gitlab": {
      const auth = connected("gitlab", await readStoredGitlabAuth());
      return { baseUrl: auth.baseUrl, userId: (await gitlabGetMyself(auth)).id };
    }
    case "linear":
      return linearGetViewerIdentity(connected("linear", await readStoredLinearAuth()));
    case "notion": {
      const auth = connected("notion", await readStoredNotionAuth());
      if (auth.kind === "oauth") return { workspaceId: auth.workspaceId, botId: auth.botId };
      return notionGetBotIdentity(auth);
    }
    case "asana": {
      const auth = connected("asana", await readStoredAsanaAuth());
      const [task, me] = await Promise.all([
        asanaFetch<{ workspace?: { gid?: string } }>(auth, `/tasks/${encodeURIComponent(destination.locator.taskGid)}?opt_fields=workspace`),
        asanaGetMyself(auth),
      ]);
      return { workspaceGid: task.workspace?.gid, userGid: me.gid };
    }
    case "clickup": {
      const auth = connected("clickup", await readStoredClickupAuth());
      const [task, me] = await Promise.all([
        clickupFetch<{ team_id?: string }>(auth, `/task/${encodeURIComponent(destination.locator.taskId)}`),
        clickupGetMyself(auth),
      ]);
      return { teamId: task.team_id, userId: me.id };
    }
    case "slack": {
      const me = await slackGetMyself(connected("slack", await readStoredSlackAuth()));
      return { teamId: me.teamId, userId: me.id };
    }
  }
}

export async function resolveAccountIdentity(destination: CreatedDestination): Promise<string> {
  if (destination.platform === "webhook") throw new Error("Webhook has no account identity");
  const identity = attachmentAccountIdentity(destination.platform, await identityParts(destination));
  if (!identity) throw new Error("Account identity unavailable");
  return identity;
}
