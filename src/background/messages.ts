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
  updateIssueDescription,
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

  const uploadMap = new Map<string, UploadedFile>();
  for (const att of attachments) {
    try {
      const blob = dataUrlToBlob(att.dataUrl);
      const results = await uploadAttachment(auth, issue.key, att.filename, blob);
      const r = results[0];
      if (r?.mediaApiFileId) {
        uploadMap.set(att.filename, { kind: "media", mediaId: r.mediaApiFileId });
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
      const screenshotFile = uploadMap.get("screenshot.png");
      if (screenshotFile) {
        const mediaPlaceholderIdx = content.findIndex(
          (n) => {
            const node = n as { type: string; content?: { text?: string }[] };
            return node.type === "paragraph" && node.content?.[0]?.text === "(첨부 이미지 참조)";
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
      } else {
        const tableIdx = content.findIndex(
          (n) => (n as { type: string }).type === "table",
        );
        if (tableIdx >= 0) {
          const tbl = content[tableIdx] as { content: unknown[] };
          tbl.content.splice(
            1,
            0,
            snapshotRow(uploadMap.get("before.png"), uploadMap.get("after.png")),
          );
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
            content: [{ type: "text", text: "스냅샷", marks: [{ type: "strong" }] }],
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
