import { t } from "@/i18n";
import { dataUrlToBlob } from "@/store/blob-db";
import { IMAGE_PLACEHOLDER, VIDEO_PLACEHOLDER, parseInlinePlaceholder } from "@/lib/adf-sentinels";
import { adfMediaNode, adfMediaSingle, adfVideoMediaSingle, type MediaSource } from "@/background/lib/adf-media";
import { injectLogsLink } from "@/background/lib/adf-logs-link";
import { injectSnapshotRows } from "@/background/injectSnapshotRows";
import { captureThrottle } from "@/background/capture-throttle";
import { injectIssueUrl } from "@/lib/inject-issue-url";
import { isFetchableSheetUrl } from "@/lib/ssrf-guard";
import type { JiraAttachmentInput, JiraAuth, JiraCreateIssuePayload, JiraSubmitResult } from "@/types/jira";
import type { GithubAuth } from "@/types/github";
import type { BgRequest } from "@/types/messages";
import {
  createIssue,
  createIssueLink,
  getIssueStatus,
  getIssueTypes,
  getMyself,
  getPriorities,
  getTransitions as getJiraTransitions,
  searchEpics,
  searchProjects,
  searchUsers,
  transitionIssue as jiraTransitionIssue,
  getMediaFileId,
  updateIssueDescription,
  uploadAttachment,
} from "./jira-api";
import {
  createIssue as createGithubIssue,
  getIssueStatus as getGithubIssueStatus,
  updateIssueState as updateGithubIssueState,
  githubFetch,
  getMyself as githubGetMyself,
  getRepoAssignees,
  getRepoLabels,
  searchRepos,
} from "./github-api";
import { uploadGithubFiles } from "./github-upload";
import {
  createAttachment as createLinearAttachment,
  createIssue as createLinearIssue,
  getIssueStatus as getLinearIssueStatus,
  getLabels as getLinearLabels,
  getMembers as getLinearMembers,
  getMyself as linearGetMyself,
  getProjects as getLinearProjects,
  getTeams as getLinearTeams,
  getWorkflowStates as getLinearWorkflowStates,
  updateIssueState as updateLinearIssueState,
  updateIssueDescription as updateLinearIssueDescription,
  uploadFileToLinear,
} from "./linear-api";
import {
  createIssue as createGitlabIssue,
  getIssueStatus as getGitlabIssueStatus,
  getMyself as gitlabGetMyself,
  getProjectLabels,
  getProjectMembers,
  searchProjects as searchGitlabProjects,
  updateIssueState as updateGitlabIssueState,
  updateIssueDescription as updateGitlabIssueDescription,
  uploadFile as uploadGitlabFile,
} from "./gitlab-api";
import {
  createTask as createAsanaTask,
  getMyself as asanaGetMyself,
  getTaskStatus as getAsanaTaskStatus,
  getWorkspaces as getAsanaWorkspaces,
  searchProjects as searchAsanaProjects,
  searchUsers as searchAsanaUsers,
  setTaskCompleted as setAsanaTaskCompleted,
  updateTaskNotes as updateAsanaTaskNotes,
  uploadAttachment as uploadAsanaAttachment,
} from "./asana-api";
import {
  createTask as createClickupTask,
  getLists as getClickupLists,
  getMembers as getClickupMembers,
  getMyself as clickupGetMyself,
  getSpaces as getClickupSpaces,
  getTaskStatus as getClickupTaskStatus,
  getTeams as getClickupTeams,
  setTaskCompleted as setClickupTaskCompleted,
  updateTaskMarkdown as updateClickupTaskMarkdown,
  uploadAttachment as uploadClickupAttachment,
} from "./clickup-api";
import { isOAuthConfigured, startOAuthFlow } from "./oauth";
import { isGithubOAuthConfigured, startGithubOAuth } from "./github-oauth";
import { isLinearOAuthConfigured, startLinearOAuth } from "./linear-oauth";
import { isNotionOAuthConfigured, startNotionOAuth } from "./notion-oauth";
import { isGitlabOAuthConfigured, startGitlabOAuth } from "./gitlab-oauth";
import { isAsanaOAuthConfigured, startAsanaOAuth } from "./asana-oauth";
import { isClickupOAuthConfigured, startClickupOAuth } from "./clickup-oauth";
import {
  getPermalink as slackGetPermalink,
  listChannels as slackListChannels,
  listMembers as slackListMembers,
  postMessage as slackPostMessage,
  uploadFiles as slackUploadFiles,
} from "./slack-api";
import { isSlackOAuthConfigured, startSlackOAuth } from "./slack-oauth";
import { captureEvent } from "./analytics";
import { trackConnect } from "./connect-tracking";
import {
  createPage as createNotionPage,
  getDatabaseSchema as getNotionDatabaseSchema,
  getMyself as notionGetMyself,
  getPageStatus as getNotionPageStatus,
  listUsers as listNotionUsers,
  searchDatabases as searchNotionDatabases,
  updatePageStatus as updateNotionPageStatus,
  uploadFile as uploadNotionFile,
} from "./notion-api";
import {
  readStoredAuth,
  readStoredGithubAuth,
  readStoredLinearAuth,
  readStoredNotionAuth,
  readStoredGitlabAuth,
  readStoredAsanaAuth,
  readStoredClickupAuth,
  readStoredSlackAuth,
} from "@/lib/settings-storage";
import type { LinearAuth } from "@/types/linear";
import type { NotionAuth } from "@/types/notion";
import type { GitlabAuth } from "@/types/gitlab";
import type { AsanaAuth } from "@/types/asana";
import type { ClickupAuth } from "@/types/clickup";
import type { SlackAuth } from "@/types/slack";

async function loadAuth(): Promise<JiraAuth> {
  const auth = await readStoredAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.jira") }));
  return auth;
}

async function loadGithubAuth(): Promise<GithubAuth> {
  const auth = await readStoredGithubAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.github") }));
  return auth;
}

async function loadLinearAuth(): Promise<LinearAuth> {
  const auth = await readStoredLinearAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.linear") }));
  return auth;
}

async function loadNotionAuth(): Promise<NotionAuth> {
  const auth = await readStoredNotionAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.notion") }));
  return auth;
}

async function loadGitlabAuth(): Promise<GitlabAuth> {
  const auth = await readStoredGitlabAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.gitlab") }));
  return auth;
}

async function loadAsanaAuth(): Promise<AsanaAuth> {
  const auth = await readStoredAsanaAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.asana") }));
  return auth;
}

async function loadClickupAuth(): Promise<ClickupAuth> {
  const auth = await readStoredClickupAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.clickup") }));
  return auth;
}

async function loadSlackAuth(): Promise<SlackAuth> {
  const auth = await readStoredSlackAuth();
  if (!auth) throw new Error(t("platform.notConnected.title", { platform: t("platform.tab.slack") }));
  return auth;
}

export async function handleMessage(
  message: BgRequest,
  _sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case "ping":
      return { pong: true, at: Date.now() };

    case "captureVisibleTab": {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.windowId) throw new Error("tab has no window");
      const windowId = tab.windowId;
      const format = message.format ?? "png";
      const opts: chrome.tabs.CaptureVisibleTabOptions = { format };
      if (format === "jpeg" && message.quality != null) {
        opts.quality = message.quality;
      }
      return captureThrottle.run(() =>
        chrome.tabs.captureVisibleTab(windowId, opts),
      );
    }

    case "oauth.available":
      return { available: isOAuthConfigured() };

    case "oauth.start":
      return trackConnect("jira", () => startOAuthFlow());

    case "jira.myself":
      return getMyself(message.config);

    case "jira.listProjects":
      return searchProjects(await loadAuth(), message.query);

    case "jira.listIssueTypes":
      return getIssueTypes(await loadAuth(), message.projectKey);

    case "jira.listPriorities":
      return getPriorities(await loadAuth());

    case "jira.searchUsers":
      return searchUsers(await loadAuth(), message.query);

    case "jira.getIssueStatus":
      return getIssueStatus(await loadAuth(), message.issueKey);

    case "jira.getTransitions":
      return getJiraTransitions(await loadAuth(), message.issueKey);

    case "jira.transitionIssue": {
      const auth = await loadAuth();
      await jiraTransitionIssue(auth, message.issueKey, message.transitionId);
      return getIssueStatus(auth, message.issueKey);
    }

    case "jira.searchEpics":
      return searchEpics(
        await loadAuth(),
        message.projectKey,
        message.query,
        message.hierarchyLevels,
      );

    case "jira.submitIssue":
      return submitIssue(
        await loadAuth(),
        message.payload,
        message.attachments,
        message.relatesKey,
      );

    case "github.oauth.available":
      return { available: isGithubOAuthConfigured() };

    case "github.startOAuth":
      return trackConnect("github", () => startGithubOAuth());

    case "github.testPat":
      return githubGetMyself({
        kind: "pat",
        pat: message.pat,
        viewerLogin: "",
      });

    case "github.disconnect":
      // 스토어 측 removeAccount("github")가 실제 정리. bg는 무상태 (서비스 워커는 상태 보관 안 함).
      return { ok: true };

    case "github.getMyself":
      return githubGetMyself(await loadGithubAuth());

    case "github.searchRepos":
      return searchRepos(await loadGithubAuth(), message.query);

    case "github.getLabels":
      return getRepoLabels(await loadGithubAuth(), message.owner, message.repo);

    case "github.searchAssignees":
      return getRepoAssignees(
        await loadGithubAuth(),
        message.owner,
        message.repo,
      );

    case "github.uploadFiles": {
      const auth = await loadGithubAuth();
      const repo = await githubFetch<{ id: number }>(
        auth,
        `/repos/${encodeURIComponent(message.owner)}/${encodeURIComponent(message.repo)}`,
      );
      return uploadGithubFiles(message.owner, message.repo, repo.id, message.files);
    }

    case "github.submitIssue":
      return createGithubIssue(await loadGithubAuth(), message.payload);

    case "github.getIssueStatus":
      return getGithubIssueStatus(
        await loadGithubAuth(),
        message.owner,
        message.repo,
        message.number,
      );

    case "github.updateIssueState":
      return updateGithubIssueState(
        await loadGithubAuth(),
        message.owner,
        message.repo,
        message.number,
        message.state,
        message.stateReason,
      );

    case "linear.oauth.available":
      return { available: isLinearOAuthConfigured() };

    case "linear.startOAuth":
      return trackConnect("linear", () => startLinearOAuth());

    case "linear.testApiKey":
      return linearGetMyself({
        kind: "apiKey",
        apiKey: message.apiKey,
        viewerName: "",
      });

    case "linear.disconnect":
      return { ok: true };

    case "linear.getMyself":
      return linearGetMyself(await loadLinearAuth());

    case "linear.getTeams":
      return getLinearTeams(await loadLinearAuth());

    case "linear.getProjects":
      return getLinearProjects(await loadLinearAuth(), message.teamId);

    case "linear.getLabels":
      return getLinearLabels(await loadLinearAuth(), message.teamId);

    case "linear.getMembers":
      return getLinearMembers(await loadLinearAuth(), message.teamId);

    case "linear.submitIssue":
      return createLinearIssue(await loadLinearAuth(), message.payload);

    case "linear.uploadFile": {
      const auth = await loadLinearAuth();
      const blob = dataUrlToBlob(message.dataUrl);
      const assetUrl = await uploadFileToLinear(auth, message.filename, message.contentType, blob);
      return { assetUrl };
    }

    case "linear.createAttachment": {
      const auth = await loadLinearAuth();
      await createLinearAttachment(auth, message.issueId, message.title, message.url);
      return { ok: true };
    }

    case "linear.getIssueStatus":
      return getLinearIssueStatus(await loadLinearAuth(), message.issueId);

    case "linear.getWorkflowStates":
      return getLinearWorkflowStates(await loadLinearAuth(), message.issueIdentifier);

    case "linear.updateIssueState":
      return updateLinearIssueState(await loadLinearAuth(), message.issueId, message.stateId);

    case "linear.updateIssueDescription":
      await updateLinearIssueDescription(await loadLinearAuth(), message.issueId, message.description);
      return { ok: true };

    case "notion.oauth.available":
      return { available: isNotionOAuthConfigured() };

    case "notion.startOAuth":
      return trackConnect("notion", () => startNotionOAuth());

    case "notion.testToken":
      return notionGetMyself({
        kind: "apiKey",
        token: message.token,
        botName: "",
      });

    case "notion.disconnect":
      return { ok: true };

    case "notion.getMyself":
      return notionGetMyself(await loadNotionAuth());

    case "notion.listUsers":
      return listNotionUsers(await loadNotionAuth());

    case "notion.searchDatabases":
      return searchNotionDatabases(await loadNotionAuth(), message.query);

    case "notion.getDatabaseSchema":
      return getNotionDatabaseSchema(await loadNotionAuth(), message.databaseId);

    case "notion.uploadFile":
      return uploadNotionFile(
        await loadNotionAuth(),
        message.filename,
        message.contentType,
        message.dataUrl,
      );

    case "notion.submitPage":
      return createNotionPage(await loadNotionAuth(), message.payload);

    case "notion.getPageStatus":
      return getNotionPageStatus(await loadNotionAuth(), message.pageId);

    case "notion.updatePageStatus":
      return updateNotionPageStatus(await loadNotionAuth(), message.pageId, message.propertyName, message.optionName);

    case "gitlab.oauth.available":
      return { available: isGitlabOAuthConfigured() };

    case "gitlab.startOAuth":
      return trackConnect("gitlab", () => startGitlabOAuth());

    case "gitlab.testPat":
      return gitlabGetMyself({
        kind: "pat",
        pat: message.pat,
        baseUrl: message.baseUrl,
        viewerUsername: "",
      });

    case "gitlab.disconnect":
      return { ok: true };

    case "gitlab.getMyself":
      return gitlabGetMyself(await loadGitlabAuth());

    case "gitlab.searchProjects":
      return searchGitlabProjects(await loadGitlabAuth(), message.query);

    case "gitlab.getLabels":
      return getProjectLabels(await loadGitlabAuth(), message.projectId);

    case "gitlab.searchAssignees":
      return getProjectMembers(await loadGitlabAuth(), message.projectId);

    case "gitlab.uploadFiles": {
      const auth = await loadGitlabAuth();
      const results: Array<{ filename: string; url: string | null }> = [];
      // 업로드 1건 실패(10MB 초과 등)가 이슈 생성 전체를 막지 않게 파일별로 격리.
      for (const f of message.files) {
        try {
          const blob = dataUrlToBlob(f.dataUrl);
          const { url } = await uploadGitlabFile(
            auth,
            message.projectId,
            f.filename,
            blob,
          );
          results.push({ filename: f.filename, url });
        } catch {
          results.push({ filename: f.filename, url: null });
        }
      }
      return results;
    }

    case "gitlab.submitIssue":
      return createGitlabIssue(await loadGitlabAuth(), message.payload);

    case "gitlab.getIssueStatus":
      return getGitlabIssueStatus(
        await loadGitlabAuth(),
        message.projectId,
        message.iid,
      );

    case "gitlab.updateIssueState":
      return updateGitlabIssueState(
        await loadGitlabAuth(),
        message.projectId,
        message.iid,
        message.state,
      );

    case "gitlab.updateIssueDescription":
      return updateGitlabIssueDescription(
        await loadGitlabAuth(),
        message.projectId,
        message.iid,
        message.description,
      );

    case "asana.oauth.available":
      return { available: isAsanaOAuthConfigured() };

    case "asana.startOAuth":
      return trackConnect("asana", () => startAsanaOAuth());

    case "asana.testPat":
      return asanaGetMyself({
        kind: "pat",
        pat: message.pat,
        viewerGid: "",
        viewerName: "",
      });

    case "asana.disconnect":
      return { ok: true };

    case "asana.getMyself":
      return asanaGetMyself(await loadAsanaAuth());

    case "asana.getWorkspaces":
      return getAsanaWorkspaces(await loadAsanaAuth());

    case "asana.searchProjects":
      return searchAsanaProjects(
        await loadAsanaAuth(),
        message.workspaceGid,
        message.query,
      );

    case "asana.searchAssignees":
      return searchAsanaUsers(
        await loadAsanaAuth(),
        message.workspaceGid,
        message.query,
      );

    case "asana.uploadFiles": {
      const auth = await loadAsanaAuth();
      const results: Array<{
        filename: string;
        gid: string | null;
        viewUrl?: string;
      }> = [];
      // 업로드 1건 실패가 task 생성 전체를 막지 않게 파일별로 격리.
      for (const f of message.files) {
        try {
          const blob = dataUrlToBlob(f.dataUrl);
          const { gid, viewUrl } = await uploadAsanaAttachment(
            auth,
            message.parent,
            f.filename,
            blob,
          );
          results.push({ filename: f.filename, gid, viewUrl });
        } catch {
          results.push({ filename: f.filename, gid: null });
        }
      }
      return results;
    }

    case "asana.submitIssue":
      return createAsanaTask(await loadAsanaAuth(), message.payload);

    case "asana.updateTaskNotes":
      return updateAsanaTaskNotes(
        await loadAsanaAuth(),
        message.taskGid,
        message.htmlNotes,
      );

    case "asana.getTaskStatus":
      return getAsanaTaskStatus(await loadAsanaAuth(), message.taskGid);

    case "asana.setCompleted":
      return setAsanaTaskCompleted(
        await loadAsanaAuth(),
        message.taskGid,
        message.completed,
      );

    case "clickup.oauth.available":
      return { available: isClickupOAuthConfigured() };

    case "clickup.startOAuth":
      return trackConnect("clickup", () => startClickupOAuth());

    case "clickup.testPat":
      return clickupGetMyself({
        kind: "pat",
        pat: message.pat,
        viewerId: "",
        viewerName: "",
      });

    case "clickup.disconnect":
      return { ok: true };

    case "clickup.getMyself":
      return clickupGetMyself(await loadClickupAuth());

    case "clickup.getTeams":
      return getClickupTeams(await loadClickupAuth());

    case "clickup.getSpaces":
      return getClickupSpaces(await loadClickupAuth(), message.teamId);

    case "clickup.getLists":
      return getClickupLists(await loadClickupAuth(), message.spaceId);

    case "clickup.getMembers":
      return getClickupMembers(await loadClickupAuth(), message.teamId);

    case "clickup.uploadFile": {
      const auth = await loadClickupAuth();
      const results: Array<{ filename: string; url: string | null }> = [];
      // 업로드 1건 실패가 task 생성 전체를 막지 않게 파일별로 격리.
      for (const f of message.files) {
        try {
          const blob = dataUrlToBlob(f.dataUrl);
          const { url } = await uploadClickupAttachment(
            auth,
            message.taskId,
            f.filename,
            blob,
          );
          results.push({ filename: f.filename, url: url ?? null });
        } catch {
          results.push({ filename: f.filename, url: null });
        }
      }
      return results;
    }

    case "clickup.submitIssue":
      return createClickupTask(await loadClickupAuth(), message.payload);

    case "clickup.updateTaskMarkdown":
      return updateClickupTaskMarkdown(
        await loadClickupAuth(),
        message.taskId,
        message.markdownContent,
      );

    case "clickup.getTaskStatus":
      return getClickupTaskStatus(await loadClickupAuth(), message.taskId);

    case "clickup.setCompleted":
      return setClickupTaskCompleted(
        await loadClickupAuth(),
        message.taskId,
        message.completed,
      );

    case "slack.oauth.available":
      return { available: isSlackOAuthConfigured() };

    case "slack.startOAuth":
      return trackConnect("slack", () => startSlackOAuth());

    case "slack.disconnect":
      return { ok: true };

    case "slack.listChannels":
      return slackListChannels(await loadSlackAuth());

    case "slack.listMembers":
      return slackListMembers(await loadSlackAuth());

    case "slack.postMessage":
      return slackPostMessage(await loadSlackAuth(), message.payload);

    case "slack.uploadFiles": {
      const auth = await loadSlackAuth();
      const files = message.files.map((f) => ({
        filename: f.filename,
        blob: dataUrlToBlob(f.dataUrl),
      }));
      return slackUploadFiles(auth, message.channelId, message.threadTs, files);
    }

    case "slack.getPermalink":
      return {
        permalink: await slackGetPermalink(
          await loadSlackAuth(),
          message.channelId,
          message.ts,
        ),
      };

    case "analytics.capture":
      return captureEvent(message.event, message.properties);

    case "css.fetchSheets":
      return { sheets: await fetchCssSheets(message.urls) };

    default: {
      const _exhaustive: never = message;
      throw new Error(`unknown message: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// cross-origin 스타일 보강용. page-controlled href를 SSRF 가드로 거른 뒤 <all_urls> CORS 우회로 fetch.
// redirect:"manual" — 가드 통과 url이 내부망으로 302 우회하는 SSRF 차단(opaqueredirect는 res.ok=false라 drop).
const MAX_SHEET_BYTES = 2_000_000;
const SHEET_FETCH_TIMEOUT_MS = 8_000;
// 비정상적으로 많은 cross-origin <link>를 가진 페이지가 SW 메모리·동시 fetch를 폭증시키는 걸 차단.
const MAX_SHEETS = 50;
async function fetchCssSheets(
  urls: string[],
): Promise<Array<{ url: string; text: string }>> {
  const allowed = urls.filter(isFetchableSheetUrl).slice(0, MAX_SHEETS);
  const settled = await Promise.allSettled(
    allowed.map(async (url) => {
      const res = await fetch(url, {
        credentials: "omit",
        redirect: "manual",
        signal: AbortSignal.timeout(SHEET_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      if (type && !type.toLowerCase().includes("css")) return null;
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > MAX_SHEET_BYTES) return null;
      const text = await readCappedText(res, MAX_SHEET_BYTES);
      if (text == null) return null;
      return { url, text };
    }),
  );
  const sheets: Array<{ url: string; text: string }> = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) sheets.push(r.value);
  }
  return sheets;
}

// content-length 누락 시에도 maxBytes 초과분을 버퍼링 전에 끊어 SW OOM을 막는다.
async function readCappedText(
  res: Response,
  maxBytes: number,
): Promise<string | null> {
  if (!res.body) {
    const text = await res.text();
    return text.length > maxBytes ? null : text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function submitIssue(
  auth: JiraAuth,
  payload: JiraCreateIssuePayload,
  attachments: JiraAttachmentInput[],
  relatesKey: string | undefined,
): Promise<JiraSubmitResult> {
  const issue = await createIssue(auth, payload);
  const issueUrl = buildIssueUrl(auth, issue.key);

  for (const att of attachments) {
    if (att.filename === "logs.html") {
      att.dataUrl = await injectIssueUrl(att.dataUrl, issueUrl, issue.key);
    }
  }

  const uploadMap = new Map<string, UploadedFile>();
  let logsDropped = false;
  let logsUrl: string | undefined;
  const attachmentBase =
    auth.kind === "apiKey"
      ? auth.baseUrl.replace(/\/+$/, "")
      : auth.siteUrl.replace(/\/+$/, "");
  for (const att of attachments) {
    try {
      const blob = dataUrlToBlob(att.dataUrl);
      const results = await uploadAttachment(auth, issue.key, att.filename, blob);
      const r = results[0];
      const mediaId = r?.mediaApiFileId || (r?.id ? await getMediaFileId(auth, String(r.id)) : undefined);
      const dims = { width: att.width, height: att.height };
      // logs.html은 media로 임베드하지 않고 본문 안내 문구에 첨부 링크로 단다.
      if (att.filename === "logs.html" && r?.id) {
        logsUrl = `${attachmentBase}/secure/attachment/${r.id}/${encodeURIComponent(r.filename)}`;
      }
      if (mediaId) {
        uploadMap.set(att.filename, { kind: "media", mediaId, ...dims });
      } else if (r?.id) {
        const url = `${attachmentBase}/secure/attachment/${r.id}/${encodeURIComponent(r.filename)}`;
        uploadMap.set(att.filename, { kind: "external", url, ...dims });
      }
    } catch (err) {
      if (att.filename === "logs.html") logsDropped = true;
      console.warn("[bugshot] attachment upload failed", att.filename, err);
    }
  }

  if (uploadMap.size > 0) {
    try {
      const desc = payload.description;
      const content: unknown[] = [...desc.content];
      const screenshotFile = uploadMap.get("screenshot.webp");
      if (screenshotFile) {
        const mediaPlaceholderIdx = content.findIndex(
          (n) => {
            const node = n as { type: string; content?: { text?: string }[] };
            return node.type === "paragraph" && node.content?.[0]?.text === IMAGE_PLACEHOLDER;
          },
        );
        if (mediaPlaceholderIdx >= 0) {
          const mediaNode = adfMediaNode(mediaSrc(screenshotFile), screenshotFile);
          content[mediaPlaceholderIdx] = adfMediaSingle(mediaNode);
        }
      }

      // recording.{webm,mp4} — extension follows whatever the MediaRecorder produced.
      let videoFile: UploadedFile | undefined;
      for (const [name, file] of uploadMap) {
        if (/^recording\.(webm|mp4)$/i.test(name)) { videoFile = file; break; }
      }
      const videoPlaceholderIdx = content.findIndex(
        (n) => {
          const node = n as { type: string; content?: { text?: string }[] };
          return node.type === "paragraph" && node.content?.[0]?.text === VIDEO_PLACEHOLDER;
        },
      );
      if (videoFile?.kind === "media" && videoPlaceholderIdx >= 0) {
        content[videoPlaceholderIdx] = adfVideoMediaSingle(mediaSrc(videoFile));
      } else if (videoPlaceholderIdx >= 0) {
        content[videoPlaceholderIdx] = {
          type: "paragraph",
          content: [{ type: "text", text: t("md.videoAttached") }],
        };
      }

      if (!screenshotFile) {
        injectSnapshotRows(content, (name) => uploadMap.get(name), snapshotRow);
      }

      for (let i = 0; i < content.length; i++) {
        const node = content[i] as { type: string; content?: { text?: string }[] };
        if (node.type !== "paragraph" || !node.content?.[0]?.text) continue;
        const refId = parseInlinePlaceholder(node.content[0].text);
        if (!refId) continue;
        const file = uploadMap.get(`inline-${refId}.webp`);
        if (!file) continue;
        const mediaNode = adfMediaNode(mediaSrc(file), file);
        content[i] = adfMediaSingle(mediaNode);
      }

      if (logsUrl) injectLogsLink(content, logsUrl);

      await updateIssueDescription(auth, issue.key, {
        version: 1,
        type: "doc",
        content,
      });
    } catch (err) {
      console.warn("[bugshot] description update with images failed", err, JSON.stringify([...uploadMap.entries()]));
    }
  }

  if (relatesKey) {
    try {
      await createIssueLink(auth, issue.key, relatesKey);
    } catch (err) {
      console.warn("[bugshot] issue link failed", relatesKey, err);
    }
  }

  return { key: issue.key, url: issueUrl, logsDropped };
}

function snapshotRow(
  beforeFile?: UploadedFile,
  afterFile?: UploadedFile,
) {
  return {
    type: "tableRow",
    content: [
      {
        type: "tableCell",
        attrs: {},
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: t("styleTable.snapshot"), marks: [{ type: "strong" }] }],
          },
        ],
      },
      snapshotCell(beforeFile),
      snapshotCell(afterFile),
    ],
  };
}

type UploadedFile = (
  | { kind: "media"; mediaId: string }
  | { kind: "external"; url: string }
) & { width?: number; height?: number };

function mediaSrc(file: UploadedFile): MediaSource {
  return file.kind === "media"
    ? { kind: "media", mediaId: file.mediaId }
    : { kind: "external", url: file.url };
}

function snapshotCell(file?: UploadedFile) {
  const emptyCell = {
    type: "tableCell" as const,
    attrs: {},
    content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
  };
  if (!file) return emptyCell;
  const mediaNode = adfMediaNode(mediaSrc(file), file);
  return {
    type: "tableCell" as const,
    attrs: {},
    content: [adfMediaSingle(mediaNode)],
  };
}

function buildIssueUrl(auth: JiraAuth, key: string): string {
  const base =
    auth.kind === "apiKey"
      ? auth.baseUrl.replace(/\/+$/, "")
      : auth.siteUrl.replace(/\/+$/, "");
  return `${base}/browse/${encodeURIComponent(key)}`;
}
