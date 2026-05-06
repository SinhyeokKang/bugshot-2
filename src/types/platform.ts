import type { JiraAuth } from "./jira";
import type { GithubAccount } from "./github";

export type PlatformId = "jira" | "github";

export interface PlatformAccountBase<P extends PlatformId> {
  platform: P;
  connectedAt: number;
}

export interface JiraAccount extends PlatformAccountBase<"jira"> {
  auth: JiraAuth;
  projectKey?: string;
  issueTypeId?: string;
  issueTypeName?: string;
  titlePrefix?: string;
}

export interface Accounts {
  jira?: JiraAccount;
  github?: GithubAccount;
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
  assignees?: string[];
}

export interface LastSubmitFieldsByPlatform {
  jira?: JiraLastSubmitFields;
  github?: GithubLastSubmitFields;
}
