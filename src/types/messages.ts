import type {
  JiraAttachmentInput,
  JiraConfigPayload,
  JiraCreateIssuePayload,
  JiraIssueSummary,
  JiraIssueType,
  JiraMyself,
  JiraPriority,
  JiraProject,
  JiraSite,
  JiraSubmitResult,
  JiraUser,
} from "./jira";

export interface OAuthStartResultMsg {
  sites: JiraSite[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type BgRequest =
  | { type: "ping" }
  | { type: "captureVisibleTab"; tabId: number }
  | { type: "oauth.start" }
  | { type: "oauth.available" }
  | { type: "jira.myself"; config: JiraConfigPayload }
  | { type: "jira.listProjects"; config: JiraConfigPayload; query?: string }
  | {
      type: "jira.listIssueTypes";
      config: JiraConfigPayload;
      projectKey: string;
    }
  | { type: "jira.listPriorities"; config: JiraConfigPayload }
  | {
      type: "jira.searchUsers";
      config: JiraConfigPayload;
      query?: string;
    }
  | {
      type: "jira.getIssueStatus";
      config: JiraConfigPayload;
      issueKey: string;
    }
  | {
      type: "jira.searchEpics";
      config: JiraConfigPayload;
      projectKey: string;
      query?: string;
      hierarchyLevels?: number[];
    }
  | {
      type: "jira.submitIssue";
      config: JiraConfigPayload;
      payload: JiraCreateIssuePayload;
      attachments: JiraAttachmentInput[];
      relatesKey?: string;
    };

export type BgResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string; status?: number; body?: unknown };

export class BgError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "BgError";
  }
}

export function sendBg<T = unknown>(req: BgRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(req, (res: BgResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!res?.ok) {
        reject(
          new BgError(
            res?.error ?? "unknown background error",
            res?.status,
            res?.body,
          ),
        );
        return;
      }
      resolve(res.result);
    });
  });
}

// Re-export common Jira types for consumers
export type {
  JiraAttachmentInput,
  JiraConfigPayload,
  JiraCreateIssuePayload,
  JiraIssueSummary,
  JiraIssueType,
  JiraMyself,
  JiraPriority,
  JiraProject,
  JiraSite,
  JiraSubmitResult,
  JiraUser,
};
