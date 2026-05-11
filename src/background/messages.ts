import { t } from "@/i18n";
import { IMAGE_PLACEHOLDER, VIDEO_PLACEHOLDER } from "@/lib/adf-sentinels";
import type { JiraAttachmentInput, JiraAuth, JiraSubmitResult } from "@/types/jira";
import type { GithubAuth } from "@/types/github";
import type { BgRequest } from "@/types/messages";
import {
  createIssue,
  createIssueLink,
  getIssueStatus,
  getIssueTypes,
  getMyself,
  getPriorities,
  searchEpics,
  searchProjects,
  searchUsers,
  getMediaFileId,
  updateIssueDescription,
  uploadAttachment,
} from "./jira-api";
import {
  createIssue as createGithubIssue,
  getIssueStatus as getGithubIssueStatus,
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
  uploadFileToLinear,
} from "./linear-api";
import { isOAuthConfigured, startOAuthFlow } from "./oauth";
import { isGithubOAuthConfigured, startGithubOAuth } from "./github-oauth";
import { isLinearOAuthConfigured, startLinearOAuth } from "./linear-oauth";
import { isNotionOAuthConfigured, startNotionOAuth } from "./notion-oauth";
import {
  createPage as createNotionPage,
  getDatabaseSchema as getNotionDatabaseSchema,
  getMyself as notionGetMyself,
  getPageStatus as getNotionPageStatus,
  searchDatabases as searchNotionDatabases,
  uploadFile as uploadNotionFile,
} from "./notion-api";
import {
  readStoredAuth,
  readStoredGithubAuth,
  readStoredLinearAuth,
  readStoredNotionAuth,
} from "@/lib/settings-storage";
import type { LinearAuth } from "@/types/linear";
import type { NotionAuth } from "@/types/notion";

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
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    }

    case "oauth.available":
      return { available: isOAuthConfigured() };

    case "oauth.start":
      return startOAuthFlow();

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
      return startGithubOAuth();

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
      const repo = await githubFetch<{ id: number }>(auth, `/repos/${message.owner}/${message.repo}`);
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

    case "linear.oauth.available":
      return { available: isLinearOAuthConfigured() };

    case "linear.startOAuth":
      return startLinearOAuth();

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

    case "notion.oauth.available":
      return { available: isNotionOAuthConfigured() };

    case "notion.startOAuth":
      return startNotionOAuth();

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

    default: {
      const _exhaustive: never = message;
      throw new Error(`unknown message: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

async function submitIssue(
  auth: JiraAuth,
  payload: import("@/types/jira").JiraCreateIssuePayload,
  attachments: JiraAttachmentInput[],
  relatesKey: string | undefined,
): Promise<JiraSubmitResult> {
  const issue = await createIssue(auth, payload);

  const uploadMap = new Map<string, UploadedFile>();
  for (const att of attachments) {
    try {
      const blob = dataUrlToBlob(att.dataUrl);
      const results = await uploadAttachment(auth, issue.key, att.filename, blob);
      const r = results[0];
      const mediaId = r?.mediaApiFileId || (r?.id ? await getMediaFileId(auth, String(r.id)) : undefined);
      if (mediaId) {
        uploadMap.set(att.filename, { kind: "media", mediaId });
      } else if (r?.id) {
        const base =
          auth.kind === "apiKey"
            ? auth.baseUrl.replace(/\/+$/, "")
            : auth.siteUrl.replace(/\/+$/, "");
        const url = `${base}/secure/attachment/${r.id}/${encodeURIComponent(r.filename)}`;
        uploadMap.set(att.filename, { kind: "external", url });
      }
    } catch (err) {
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
          const mediaNode =
            screenshotFile.kind === "media"
              ? { type: "media", attrs: { type: "file", id: screenshotFile.mediaId, collection: "" } }
              : { type: "media", attrs: { type: "external", url: screenshotFile.url } };
          content[mediaPlaceholderIdx] = {
            type: "mediaSingle",
            attrs: { layout: "center" },
            content: [mediaNode],
          };
        }
      }

      const videoFile = uploadMap.get("recording.webm");
      const videoPlaceholderIdx = content.findIndex(
        (n) => {
          const node = n as { type: string; content?: { text?: string }[] };
          return node.type === "paragraph" && node.content?.[0]?.text === VIDEO_PLACEHOLDER;
        },
      );
      if (videoFile && videoPlaceholderIdx >= 0) {
        const mediaNode =
          videoFile.kind === "media"
            ? { type: "media", attrs: { type: "file", id: videoFile.mediaId, collection: "" } }
            : { type: "media", attrs: { type: "external", url: videoFile.url } };
        content[videoPlaceholderIdx] = {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [mediaNode],
        };
      } else if (videoPlaceholderIdx >= 0) {
        content[videoPlaceholderIdx] = {
          type: "paragraph",
          content: [{ type: "text", text: t("md.videoAttached") }],
        };
      }

      if (!screenshotFile) {
        const beforeFile = uploadMap.get("before.webp");
        const afterFile = uploadMap.get("after.webp");
        if (beforeFile || afterFile) {
          const tableIdx = content.findIndex(
            (n) => (n as { type: string }).type === "table",
          );
          if (tableIdx >= 0) {
            const tbl = JSON.parse(JSON.stringify(content[tableIdx])) as { content: unknown[] };
            tbl.content.splice(1, 0, snapshotRow(beforeFile, afterFile));
            content[tableIdx] = tbl;
          }
        }
      }
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

  const url = buildIssueUrl(auth, issue.key);
  return { key: issue.key, url };
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

type UploadedFile = { kind: "media"; mediaId: string } | { kind: "external"; url: string };

function snapshotCell(file?: UploadedFile) {
  const emptyCell = {
    type: "tableCell" as const,
    attrs: {},
    content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
  };
  if (!file) return emptyCell;
  const mediaNode =
    file.kind === "media"
      ? { type: "media", attrs: { type: "file", id: file.mediaId, collection: "" } }
      : { type: "media", attrs: { type: "external", url: file.url } };
  return {
    type: "tableCell" as const,
    attrs: {},
    content: [
      {
        type: "mediaSingle",
        attrs: { layout: "center" },
        content: [mediaNode],
      },
    ],
  };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(.*?);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("invalid data URL");
  const mime = match[1];
  const binary = atob(match[2]);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function buildIssueUrl(auth: JiraAuth, key: string): string {
  const base =
    auth.kind === "apiKey"
      ? auth.baseUrl.replace(/\/+$/, "")
      : auth.siteUrl.replace(/\/+$/, "");
  return `${base}/browse/${encodeURIComponent(key)}`;
}
