import type { PlatformAccountBase } from "./platform";

export interface LinearApiKeyAuth {
  kind: "apiKey";
  apiKey: string;
  viewerName: string;
  viewerEmail?: string;
}

export interface LinearOAuthAuth {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  viewerName: string;
  viewerEmail?: string;
  grantedAt: number;
}

export type LinearAuth = LinearApiKeyAuth | LinearOAuthAuth;

export interface LinearDefaults {
  teamId?: string;
  teamName?: string;
  teamKey?: string;
  projectId?: string;
  projectName?: string;
  labelId?: string;
  labelName?: string;
  assigneeId?: string;
  priority?: number;
}

export interface LinearAccount extends PlatformAccountBase<"linear"> {
  auth: LinearAuth;
  defaults: LinearDefaults;
}

export interface LinearMyself {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
  state: string;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

export interface LinearUser {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface LinearCreateIssuePayload {
  teamId: string;
  title: string;
  description: string;
  projectId?: string;
  assigneeId?: string;
  labelId?: string;
  priority?: number;
}

export interface LinearCreateIssueResult {
  id: string;
  identifier: string;
  url: string;
}

export interface LinearIssueStatus {
  identifier: string;
  title: string;
  state: { name: string; type: string };
  url: string;
  labels: { name: string; color: string }[];
}

export interface LinearFileUploadResult {
  assetUrl: string;
  uploadUrl: string;
  headers: { key: string; value: string }[];
}

export interface LinearAttachmentInput {
  filename: string;
  dataUrl: string;
}
