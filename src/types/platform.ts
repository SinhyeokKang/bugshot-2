import type { JiraAuth } from "./jira";
import type { GithubAccount } from "./github";
import type { LinearAccount } from "./linear";

export type PlatformId = "jira" | "github" | "linear";

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

export interface NormalizedSubmitResult {
  key: string;
  url: string;
}

export interface LastSubmitFieldsByPlatform {
  jira?: JiraLastSubmitFields;
  github?: GithubLastSubmitFields;
  linear?: LinearLastSubmitFields;
}
