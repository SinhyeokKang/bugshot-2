import type { JiraAuth } from "./jira";
import type { GithubAccount } from "./github";
import type { LinearAccount } from "./linear";
import type { NotionAccount } from "./notion";

export type PlatformId = "jira" | "github" | "linear" | "notion";

export const PLATFORM_TAB_KEYS = {
  jira: "platform.tab.jira",
  github: "platform.tab.github",
  linear: "platform.tab.linear",
  notion: "platform.tab.notion",
} as const satisfies Record<PlatformId, string>;

export interface PlatformAccountBase<P extends PlatformId> {
  platform: P;
  connectedAt: number;
}

export interface JiraAccount extends PlatformAccountBase<"jira"> {
  auth: JiraAuth;
  projectKey?: string;
  issueTypeId?: string;
  issueTypeName?: string;
}

export interface Accounts {
  jira?: JiraAccount;
  github?: GithubAccount;
  linear?: LinearAccount;
  notion?: NotionAccount;
}

export interface JiraLastSubmitFields {
  projectKey?: string;
  assigneeId?: string;
  assigneeName?: string;
  priorityId?: string;
  priorityName?: string;
  parentKey?: string;
  parentLabel?: string;
  relatesKey?: string;
  relatesLabel?: string;
}

export interface GithubLastSubmitFields {
  owner?: string;
  repo?: string;
  label?: string;
  assignee?: string;
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
}

export interface NormalizedSubmitResult {
  key: string;
  url: string;
}

export interface LastSubmitFieldsByPlatform {
  jira?: JiraLastSubmitFields;
  github?: GithubLastSubmitFields;
  linear?: LinearLastSubmitFields;
  notion?: NotionLastSubmitFields;
}
