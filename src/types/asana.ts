import type { PlatformAccountBase } from "./platform";

export interface AsanaPatAuth {
  kind: "pat";
  pat: string;
  viewerGid: string;
  viewerName: string;
  viewerEmail?: string;
}

export interface AsanaOAuthAuth {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  grantedAt: number;
  viewerGid: string;
  viewerName: string;
  viewerEmail?: string;
}

export type AsanaAuth = AsanaPatAuth | AsanaOAuthAuth;

export interface AsanaDefaults {
  workspaceGid?: string;
  workspaceName?: string;
  projectGid?: string;
  projectName?: string;
}

export interface AsanaAccount extends PlatformAccountBase<"asana"> {
  auth: AsanaAuth;
  defaults: AsanaDefaults;
}

export interface AsanaMyself {
  gid: string;
  name: string;
  email?: string;
}

export interface AsanaWorkspace {
  gid: string;
  name: string;
}

export interface AsanaProject {
  gid: string;
  name: string;
}

export interface AsanaUser {
  gid: string;
  name: string;
  email?: string;
}

export interface AsanaCreateTaskPayload {
  workspaceGid: string;
  projectGid?: string;
  name: string;
  htmlNotes: string;
  assigneeGid?: string;
}

export interface AsanaCreateTaskResult {
  gid: string;
  permalinkUrl: string;
}

export interface AsanaTaskStatus {
  gid: string;
  name: string;
  completed: boolean;
  permalinkUrl: string;
}
