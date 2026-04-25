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
  | { type: "tabCapture.getStreamId"; tabId: number }
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
        reject(new Error("확장 프로그램 내부 통신 오류. 페이지를 새로고침해주세요."));
        return;
      }
      if (!res?.ok) {
        const err = new BgError(
          res?.error ?? "알 수 없는 오류가 발생했습니다.",
          res?.status,
          res?.body,
        );
        if (isOAuthRefreshFailed(err)) onOAuthExpired.fire();
        reject(err);
        return;
      }
      resolve(res.result);
    });
  });
}

export function isOAuthRefreshFailed(err: unknown): boolean {
  return err instanceof BgError &&
    !!err.body &&
    (err.body as Record<string, unknown>).oauthRefreshFailed === true;
}

type Listener = () => void;
export const onOAuthExpired = {
  _listeners: new Set<Listener>(),
  subscribe(fn: Listener) { this._listeners.add(fn); return () => { this._listeners.delete(fn); }; },
  fire() { this._listeners.forEach((fn) => fn()); },
};

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
