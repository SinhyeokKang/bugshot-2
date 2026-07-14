import type { PlatformAccountBase } from "./platform";

export interface GitlabPatAuth {
  kind: "pat";
  pat: string;
  baseUrl: string;
  viewerUsername: string;
  viewerEmail?: string;
}

export interface GitlabOAuthAuth {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  baseUrl: string;
  viewerUsername: string;
  viewerEmail?: string;
  grantedAt: number;
}

export type GitlabAuth = GitlabPatAuth | GitlabOAuthAuth;

export interface GitlabDefaults {
  projectId?: number;
  projectPath?: string;
  label?: string;
  // 필드값과 같은 형태(id + 표시명)로 저장 — 과거 `assignee?: string`은 런타임 assigneeId(number)와
  // 불일치한 채 쓰이지도 않던 dead field였다.
  assigneeId?: number;
  assigneeName?: string;
}

export interface GitlabAccount extends PlatformAccountBase<"gitlab"> {
  auth: GitlabAuth;
  defaults: GitlabDefaults;
}

export interface GitlabMyself {
  id: number;
  username: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface GitlabProject {
  id: number;
  pathWithNamespace: string;
  name: string;
  nameWithNamespace: string;
  webUrl: string;
}

export interface GitlabLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

export interface GitlabMember {
  id: number;
  username: string;
  name: string;
  avatarUrl?: string;
}

export interface GitlabCreateIssuePayload {
  projectId: number;
  title: string;
  description: string;
  labels?: string[];
  assigneeIds?: number[];
}

export interface GitlabCreateIssueResult {
  iid: number;
  id: number;
  url: string;
}

export interface GitlabIssueStatus {
  iid: number;
  title: string;
  state: "opened" | "closed";
  webUrl: string;
  labels: string[];
}
