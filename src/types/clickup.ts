import type { PlatformAccountBase } from "./platform";

export interface ClickupPatAuth {
  kind: "pat";
  pat: string; // pk_...
  viewerId: string;
  viewerName: string;
  viewerEmail?: string;
}

export interface ClickupOAuthAuth {
  kind: "oauth";
  accessToken: string; // 만료 없음 → expiresAt/refreshToken 없음
  grantedAt: number;
  viewerId: string;
  viewerName: string;
  viewerEmail?: string;
}

export type ClickupAuth = ClickupPatAuth | ClickupOAuthAuth;

export interface ClickupDefaults {
  workspaceId?: string;
  workspaceName?: string;
  spaceId?: string;
  spaceName?: string;
  listId?: string;
  listName?: string;
  assigneeId?: string;
  assigneeName?: string;
}

export interface ClickupAccount extends PlatformAccountBase<"clickup"> {
  auth: ClickupAuth;
  defaults: ClickupDefaults;
}

export interface ClickupMyself {
  id: string;
  name: string;
  email?: string;
}

export interface ClickupWorkspace {
  id: string;
  name: string;
}

export interface ClickupSpace {
  id: string;
  name: string;
}

export interface ClickupList {
  id: string;
  name: string;
  folderName?: string;
}

export interface ClickupUser {
  id: string;
  name: string;
  email?: string;
}

export interface ClickupCreateTaskPayload {
  listId: string;
  name: string;
  markdownContent: string; // → ClickUp `markdown_content`
  assignees?: string[]; // user id (정수 문자열)
}

export interface ClickupCreateTaskResult {
  id: string;
  url: string;
}

export interface ClickupTaskStatus {
  id: string;
  name: string;
  completed: boolean;
  url: string;
}
