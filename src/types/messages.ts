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
  JiraTransition,
  JiraUser,
} from "./jira";
import type {
  GithubCreateIssuePayload,
  GithubCreateIssueResult,
  GithubIssueStatus,
  GithubLabel,
  GithubMyself,
  GithubOAuthAuth,
  GithubRepo,
  GithubUser,
} from "./github";
import type {
  LinearAttachmentInput,
  LinearCreateIssuePayload,
  LinearCreateIssueResult,
  LinearIssueStatus,
  LinearLabel,
  LinearMyself,
  LinearProject,
  LinearTeam,
  LinearUser,
  LinearWorkflowState,
} from "./linear";
import type {
  NotionCreatePagePayload,
  NotionCreatePageResult,
  NotionDatabase,
  NotionDatabaseSchema,
  NotionFileUploadResult,
  NotionMyself,
  NotionPageStatus,
} from "./notion";
import type {
  GitlabCreateIssuePayload,
  GitlabCreateIssueResult,
  GitlabIssueStatus,
  GitlabLabel,
  GitlabMember,
  GitlabMyself,
  GitlabProject,
} from "./gitlab";
import type {
  AsanaCreateTaskPayload,
  AsanaCreateTaskResult,
  AsanaMyself,
  AsanaProject,
  AsanaTaskStatus,
  AsanaUser,
  AsanaWorkspace,
} from "./asana";
import type { ClickupCreateTaskPayload } from "./clickup";
import type { SlackPostMessagePayload } from "./slack";

export interface OAuthStartResultMsg {
  sites: JiraSite[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type BgRequest =
  | { type: "ping" }
  | {
      type: "captureVisibleTab";
      tabId: number;
      format?: "jpeg" | "png";
      quality?: number;
    }
  | { type: "oauth.start" }
  | { type: "oauth.available" }
  | { type: "jira.myself"; config: JiraConfigPayload }
  | { type: "jira.listProjects"; query?: string }
  | { type: "jira.listIssueTypes"; projectKey: string }
  | { type: "jira.listPriorities" }
  | { type: "jira.searchUsers"; query?: string }
  | { type: "jira.getUsers"; accountIds: string[] }
  | { type: "jira.getIssueStatus"; issueKey: string }
  | { type: "jira.getTransitions"; issueKey: string }
  | { type: "jira.transitionIssue"; issueKey: string; transitionId: string }
  | {
      type: "jira.searchEpics";
      projectKey: string;
      query?: string;
      hierarchyLevels?: number[];
    }
  | { type: "jira.sprintFieldMeta"; projectKey: string; issueTypeId: string }
  | { type: "jira.listSprints"; projectKey: string }
  | { type: "jira.getSprint"; sprintId: number }
  | {
      type: "jira.submitIssue";
      payload: JiraCreateIssuePayload;
      attachments: JiraAttachmentInput[];
      relates?: string[];
    }
  | { type: "github.oauth.available" }
  | { type: "github.startOAuth" }
  | { type: "github.testPat"; pat: string }
  | { type: "github.disconnect" }
  | { type: "github.getMyself" }
  | { type: "github.searchRepos"; query: string }
  | { type: "github.getLabels"; owner: string; repo: string }
  | { type: "github.searchAssignees"; owner: string; repo: string }
  | {
      type: "github.uploadFiles";
      owner: string;
      repo: string;
      files: Array<{ filename: string; contentType: string; dataUrl: string }>;
    }
  | {
      type: "github.submitIssue";
      payload: GithubCreateIssuePayload;
    }
  | {
      type: "github.getIssueStatus";
      owner: string;
      repo: string;
      number: number;
    }
  | {
      type: "github.updateIssueState";
      owner: string;
      repo: string;
      number: number;
      state: "open" | "closed";
      stateReason?: "completed" | "not_planned" | null;
    }
  | { type: "linear.oauth.available" }
  | { type: "linear.startOAuth" }
  | { type: "linear.testApiKey"; apiKey: string }
  | { type: "linear.disconnect" }
  | { type: "linear.getMyself" }
  | { type: "linear.getTeams" }
  | { type: "linear.getProjects"; teamId: string }
  | { type: "linear.getLabels"; teamId: string }
  | { type: "linear.getMembers"; teamId: string }
  | { type: "linear.submitIssue"; payload: LinearCreateIssuePayload }
  | { type: "linear.uploadFile"; filename: string; contentType: string; dataUrl: string }
  | { type: "linear.createAttachment"; issueId: string; title: string; url: string }
  | { type: "linear.getIssueStatus"; issueId: string }
  | { type: "linear.getWorkflowStates"; issueIdentifier: string }
  | { type: "linear.updateIssueState"; issueId: string; stateId: string }
  | { type: "linear.updateIssueDescription"; issueId: string; description: string }
  | { type: "notion.oauth.available" }
  | { type: "notion.startOAuth" }
  | { type: "notion.testToken"; token: string }
  | { type: "notion.disconnect" }
  | { type: "notion.getMyself" }
  | { type: "notion.listUsers" }
  | { type: "notion.searchDatabases"; query: string }
  | { type: "notion.getDatabaseSchema"; databaseId: string }
  | { type: "notion.uploadFile"; filename: string; contentType: string; dataUrl: string }
  | { type: "notion.submitPage"; payload: NotionCreatePagePayload }
  | { type: "notion.getPageStatus"; pageId: string }
  | { type: "notion.updatePageStatus"; pageId: string; propertyName: string; optionName: string }
  | { type: "gitlab.oauth.available" }
  | { type: "gitlab.startOAuth" }
  | { type: "gitlab.testPat"; pat: string; baseUrl: string }
  | { type: "gitlab.disconnect" }
  | { type: "gitlab.getMyself" }
  | { type: "gitlab.searchProjects"; query: string }
  | { type: "gitlab.getLabels"; projectId: number }
  | { type: "gitlab.searchAssignees"; projectId: number }
  | {
      type: "gitlab.uploadFiles";
      projectId: number;
      files: Array<{ filename: string; contentType: string; dataUrl: string }>;
    }
  | { type: "gitlab.submitIssue"; payload: GitlabCreateIssuePayload }
  | { type: "gitlab.getIssueStatus"; projectId: number; iid: number }
  | {
      type: "gitlab.updateIssueState";
      projectId: number;
      iid: number;
      state: "opened" | "closed";
    }
  | {
      type: "gitlab.updateIssueDescription";
      projectId: number;
      iid: number;
      description: string;
    }
  | { type: "asana.oauth.available" }
  | { type: "asana.startOAuth" }
  | { type: "asana.testPat"; pat: string }
  | { type: "asana.disconnect" }
  | { type: "asana.getMyself" }
  | { type: "asana.getWorkspaces" }
  | { type: "asana.searchProjects"; workspaceGid: string; query: string }
  | { type: "asana.searchAssignees"; workspaceGid: string; query: string }
  | {
      type: "asana.uploadFiles";
      parent: string;
      files: Array<{ filename: string; contentType: string; dataUrl: string }>;
    }
  | { type: "asana.submitIssue"; payload: AsanaCreateTaskPayload }
  | { type: "asana.updateTaskNotes"; taskGid: string; htmlNotes: string }
  | { type: "asana.getTaskStatus"; taskGid: string }
  | { type: "asana.setCompleted"; taskGid: string; completed: boolean }
  | { type: "clickup.oauth.available" }
  | { type: "clickup.startOAuth" }
  | { type: "clickup.testPat"; pat: string }
  | { type: "clickup.disconnect" }
  | { type: "clickup.getMyself" }
  | { type: "clickup.getTeams" }
  | { type: "clickup.getSpaces"; teamId: string }
  | { type: "clickup.getLists"; spaceId: string }
  | { type: "clickup.getMembers"; teamId: string }
  | {
      type: "clickup.uploadFile";
      taskId: string;
      files: Array<{ filename: string; contentType: string; dataUrl: string }>;
    }
  | { type: "clickup.submitIssue"; payload: ClickupCreateTaskPayload }
  | { type: "clickup.updateTaskMarkdown"; taskId: string; markdownContent: string }
  | { type: "clickup.getTaskStatus"; taskId: string }
  | { type: "clickup.setCompleted"; taskId: string; completed: boolean }
  | { type: "slack.oauth.available" }
  | { type: "slack.startOAuth" }
  | { type: "slack.disconnect" }
  | { type: "slack.listChannels" }
  | { type: "slack.listMembers" }
  | { type: "slack.postMessage"; payload: SlackPostMessagePayload }
  | {
      type: "slack.uploadFiles";
      channelId: string;
      threadTs: string;
      files: Array<{ filename: string; dataUrl: string }>;
    }
  | { type: "slack.getPermalink"; channelId: string; ts: string }
  | { type: "analytics.capture"; event: string; properties: Record<string, string> }
  | { type: "css.fetchSheets"; urls: string[] };

// handleMessage를 거치지 않는 bg→sidepanel 내부 통신 메시지.
export type BgInternalMessage =
  | { type: "logClear"; tabId: number }
  | { type: "activeTabExpiredDeferred"; tabId: number }
  | { type: "frameCommitted"; tabId: number; frameId: number; documentId?: string };

export type BgResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string; status?: number; body?: unknown };

// Re-export common platform types for consumers
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
  JiraTransition,
  JiraUser,
  GithubCreateIssuePayload,
  GithubCreateIssueResult,
  GithubIssueStatus,
  GithubLabel,
  GithubMyself,
  GithubOAuthAuth,
  GithubRepo,
  GithubUser,
  LinearAttachmentInput,
  LinearCreateIssuePayload,
  LinearCreateIssueResult,
  LinearIssueStatus,
  LinearLabel,
  LinearMyself,
  LinearProject,
  LinearTeam,
  LinearUser,
  LinearWorkflowState,
  NotionCreatePagePayload,
  NotionCreatePageResult,
  NotionDatabase,
  NotionDatabaseSchema,
  NotionFileUploadResult,
  NotionMyself,
  NotionPageStatus,
  GitlabCreateIssuePayload,
  GitlabCreateIssueResult,
  GitlabIssueStatus,
  GitlabLabel,
  GitlabMember,
  GitlabMyself,
  GitlabProject,
  AsanaCreateTaskPayload,
  AsanaCreateTaskResult,
  AsanaMyself,
  AsanaProject,
  AsanaTaskStatus,
  AsanaUser,
  AsanaWorkspace,
};
