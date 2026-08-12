import type { LocaleMode } from "@/i18n/locales";
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
  emailAddress?: string;
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
  // 본문 언어. background는 currentLocale 인스턴스가 별도라 사이드패널 래핑이 안 닿는다.
  // 구버전 메시지엔 없으므로 optional — 누락 시 background 화면 언어로 떨어진다.
  bodyLocale?: LocaleMode;
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
  width?: number;
  height?: number;
}

export interface JiraAttachmentResult {
  id: string;
  filename: string;
  content?: string;
  mediaApiFileId?: string;
}

export interface JiraSubmitResult {
  key: string;
  url: string;
  logsDropped?: boolean;
}

export interface JiraIssueStatus {
  name: string;
  categoryKey: string;
  issueTypeName?: string;
  summary?: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
    categoryKey: string;
  };
}
