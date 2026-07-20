import type { JiraAuth } from "./jira";
import type { GithubAccount } from "./github";
import type { LinearAccount } from "./linear";
import type { NotionAccount } from "./notion";
import type { GitlabAccount } from "./gitlab";
import type { AsanaAccount } from "./asana";
import type { ClickupAccount } from "./clickup";
import type { SlackAccount } from "./slack";

export type PlatformId =
  | "jira"
  | "github"
  | "linear"
  | "notion"
  | "gitlab"
  | "asana"
  | "clickup"
  | "slack";

export const PLATFORM_TAB_KEYS = {
  jira: "platform.tab.jira",
  github: "platform.tab.github",
  linear: "platform.tab.linear",
  notion: "platform.tab.notion",
  gitlab: "platform.tab.gitlab",
  asana: "platform.tab.asana",
  clickup: "platform.tab.clickup",
  slack: "platform.tab.slack",
} as const satisfies Record<PlatformId, string>;

// 이슈 본문 cc 줄 포맷 — sidepanel 빌더(ccMention)와 background(notion expandBlock)가 공유.
export const CC_PREFIX = "cc ";
export const CC_SEPARATOR = ", ";

export interface PlatformAccountBase<P extends PlatformId> {
  platform: P;
  connectedAt: number;
}

export interface JiraAccount extends PlatformAccountBase<"jira"> {
  auth: JiraAuth;
  projectKey?: string;
  issueTypeId?: string;
  issueTypeName?: string;
  // 기본 담당자. 다른 플랫폼의 defaults 객체에 해당하나 Jira 계정은 평면 구조라 여기 둔다.
  assigneeId?: string;
  assigneeName?: string;
}

export interface Accounts {
  jira?: JiraAccount;
  github?: GithubAccount;
  linear?: LinearAccount;
  notion?: NotionAccount;
  gitlab?: GitlabAccount;
  asana?: AsanaAccount;
  clickup?: ClickupAccount;
  slack?: SlackAccount;
}

export interface JiraLastSubmitFields {
  projectKey?: string;
  assigneeId?: string;
  assigneeName?: string;
  priorityId?: string;
  priorityName?: string;
  parentKey?: string;
  parentLabel?: string;
  relates?: { key: string; label: string }[];
  cc?: { accountId: string; displayName: string }[];
}

export interface GithubLastSubmitFields {
  owner?: string;
  repo?: string;
  label?: string;
  assignee?: string;
  cc?: string[];
}

export interface LinearLastSubmitFields {
  teamId?: string;
  teamName?: string;
  teamKey?: string;
  projectId?: string;
  projectName?: string;
  labelId?: string;
  labelName?: string;
  assigneeId?: string;
  assigneeName?: string;
  priority?: number;
  cc?: { id: string; name: string }[];
}

export interface NotionLastSubmitFields {
  databaseId?: string;
  databaseTitle?: string;
  statusOption?: string;
  selectValues?: {
    propertyName: string;
    type: "select" | "multi_select";
    options: string[];
  }[];
  cc?: { id: string; name: string }[];
}

export interface NormalizedSubmitResult {
  key: string;
  url: string;
  // logs.html 첨부가 플랫폼 용량 한도로 격리 처리돼 누락됐을 때 true (이슈는 생성됨).
  logsDropped?: boolean;
}

export interface GitlabLastSubmitFields {
  projectId?: number;
  projectPath?: string;
  label?: string;
  // GitLab create API는 assignee_ids(숫자)만 받으므로 username이 아닌 id를 보존 (Linear 패턴).
  assigneeId?: number;
  assigneeName?: string;
  cc?: { username: string; name: string }[];
}

export interface AsanaLastSubmitFields {
  workspaceGid?: string;
  workspaceName?: string;
  projectGid?: string;
  projectName?: string;
  assigneeGid?: string;
  assigneeName?: string;
  cc?: { gid: string; name: string }[];
}

export interface ClickupLastSubmitFields {
  workspaceId?: string;
  workspaceName?: string;
  spaceId?: string;
  spaceName?: string;
  listId?: string;
  listName?: string;
  assigneeId?: string;
  assigneeName?: string;
  cc?: { id: string; name: string }[];
}

export interface SlackLastSubmitFields {
  channelId?: string;
  channelName?: string;
  mentions?: { id: string; name: string }[];
}

export interface LastSubmitFieldsByPlatform {
  jira?: JiraLastSubmitFields;
  github?: GithubLastSubmitFields;
  linear?: LinearLastSubmitFields;
  notion?: NotionLastSubmitFields;
  gitlab?: GitlabLastSubmitFields;
  asana?: AsanaLastSubmitFields;
  clickup?: ClickupLastSubmitFields;
  slack?: SlackLastSubmitFields;
}
