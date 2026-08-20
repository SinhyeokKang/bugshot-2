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

export interface JiraSprint {
  id: number;
  name: string;
  // 서버 문자열 그대로 둔다. union으로 좁히면 미지 값이 타입 위에서만 사라지고 런타임에서는
  // 그대로 흘러 닫힌 스프린트가 유효로 샌다 — 판정은 isActiveSprint() 단일 출처.
  state: string;
  // 단건 조회(getSprint) 경로는 보드를 모른다.
  boardName?: string;
}

export interface JiraSprintFieldMeta {
  // 사이트마다 다르다("customfield_10020"은 실측 사이트의 값일 뿐).
  fieldId: string;
  isArray: boolean;
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
  // fieldId·isArray는 싣지 않는다 — 다이얼로그를 연 뒤 이슈타입이 바뀌면 stale해지므로
  // background가 제출 시점에 다시 해석한다(design A1).
  sprintId?: number;
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
  /**
   * 사용자가 붙인 파일. 캡처와 한 배열에 섞이고 표시명이 원본 파일명이라 이름이 겹칠 수 있는데,
   * 본문 인라인·로그 백링크는 캡처만 대상이다. 배열이 realm을 건너므로 위치가 아니라 표식으로 나른다.
   */
  userAttachment?: boolean;
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
