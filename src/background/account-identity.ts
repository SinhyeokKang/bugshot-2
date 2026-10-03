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
import { ensureFreshAuth, getMyself as jiraGetMyself } from "./jira-api";
import { githubFetch } from "./github-api";
import { getMyself as gitlabGetMyself } from "./gitlab-api";
import { getViewerIdentity as linearGetViewerIdentity } from "./linear-api";
import { getBotIdentity as notionGetBotIdentity } from "./notion-api";
import { asanaFetch, getMyself as asanaGetMyself } from "./asana-api";
import { clickupFetch, getMyself as clickupGetMyself } from "./clickup-api";
import { getMyself as slackGetMyself } from "./slack-api";

function connected<T>(auth: T | null): T {
  if (!auth) throw new Error("Platform is not connected");
  return auth;
}

// Parts come from the *current* connection (site, base URL, account) plus the immutable
// destination where the scope is per-task, so a reconnect to another account never matches.
async function identityParts(destination: Extract<CreatedDestination, { platform: RetryPlatform }>): Promise<Record<string, unknown>> {
  switch (destination.platform) {
    case "jira": {
      const auth = await ensureFreshAuth(connected(await readStoredAuth()));
      const me = await jiraGetMyself(auth);
      return { siteId: auth.kind === "oauth" ? auth.cloudId : auth.baseUrl, accountId: me.accountId };
    }
    case "github": {
      // GET /user only — getMyself would also read /user/emails, which identity does not need.
      const me = await githubFetch<{ id?: number }>(connected(await readStoredGithubAuth()), "/user");
      return { userId: me.id };
    }
    case "gitlab": {
      const auth = connected(await readStoredGitlabAuth());
      return { baseUrl: auth.baseUrl, userId: (await gitlabGetMyself(auth)).id };
    }
    case "linear":
      return linearGetViewerIdentity(connected(await readStoredLinearAuth()));
    case "notion": {
      const auth = connected(await readStoredNotionAuth());
      if (auth.kind === "oauth") return { workspaceId: auth.workspaceId, botId: auth.botId };
      return notionGetBotIdentity(auth);
    }
    case "asana": {
      const auth = connected(await readStoredAsanaAuth());
      const [task, me] = await Promise.all([
        asanaFetch<{ workspace?: { gid?: string } }>(auth, `/tasks/${encodeURIComponent(destination.locator.taskGid)}?opt_fields=workspace`),
        asanaGetMyself(auth),
      ]);
      return { workspaceGid: task.workspace?.gid, userGid: me.gid };
    }
    case "clickup": {
      const auth = connected(await readStoredClickupAuth());
      const [task, me] = await Promise.all([
        clickupFetch<{ team_id?: string }>(auth, `/task/${encodeURIComponent(destination.locator.taskId)}`),
        clickupGetMyself(auth),
      ]);
      return { teamId: task.team_id, userId: me.id };
    }
    case "slack": {
      const me = await slackGetMyself(connected(await readStoredSlackAuth()));
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
