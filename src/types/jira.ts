export interface JiraApiKeyAuth {
  kind: "apiKey";
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraOAuthAuth {
  kind: "oauth";
  cloudId: string;
  siteUrl: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type JiraAuth = JiraApiKeyAuth | JiraOAuthAuth;

export type JiraConfigPayload = JiraAuth;

export interface JiraMyself {
  accountId: string;
  emailAddress: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraSite {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl?: string;
  hierarchyLevel?: number;
  subtask?: boolean;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  fields: {
    summary: string;
    issuetype?: { name: string; iconUrl?: string };
  };
}

export interface JiraAdfDoc {
  version: 1;
  type: "doc";
  content: unknown[];
}

export interface JiraCreateIssuePayload {
  projectKey: string;
  summary: string;
  description: JiraAdfDoc;
  issueTypeId: string;
  assigneeAccountId?: string;
  priorityId?: string;
  parentKey?: string;
}

export interface JiraCreateIssueResult {
  id: string;
  key: string;
  self: string;
}

export interface JiraAttachmentInput {
  filename: string;
  dataUrl: string;
}

export interface JiraSubmitResult {
  key: string;
  url: string;
}

export interface JiraIssueStatus {
  name: string;
  categoryKey: string;
}
