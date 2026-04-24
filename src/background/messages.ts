import type { JiraAttachmentInput, JiraAuth, JiraSubmitResult } from "@/types/jira";
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
  uploadAttachment,
} from "./jira-api";
import { isOAuthConfigured, startOAuthFlow } from "./oauth";

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
      return searchProjects(message.config, message.query);

    case "jira.listIssueTypes":
      return getIssueTypes(message.config, message.projectKey);

    case "jira.listPriorities":
      return getPriorities(message.config);

    case "jira.searchUsers":
      return searchUsers(message.config, message.query);

    case "jira.getIssueStatus":
      return getIssueStatus(message.config, message.issueKey);

    case "jira.searchEpics":
      return searchEpics(message.config, message.projectKey, message.query, message.hierarchyLevels);

    case "jira.submitIssue":
      return submitIssue(
        message.config,
        message.payload,
        message.attachments,
        message.relatesKey,
      );

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

  for (const att of attachments) {
    try {
      const blob = dataUrlToBlob(att.dataUrl);
      await uploadAttachment(auth, issue.key, att.filename, blob);
    } catch (err) {
      console.warn("[bugshot] attachment upload failed", att.filename, err);
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

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
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
