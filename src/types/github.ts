import type { PlatformAccountBase } from "./platform";

export interface GithubPatAuth {
  kind: "pat";
  pat: string;
  viewerLogin: string;
  viewerEmail?: string;
}

export interface GithubOAuthAuth {
  kind: "oauth";
  accessToken: string;
  tokenType: string;
  scope: string;
  refreshToken?: string;
  expiresAt?: number;
  viewerLogin: string;
  viewerEmail?: string;
  grantedAt: number;
}

export type GithubAuth = GithubPatAuth | GithubOAuthAuth;

export interface GithubDefaults {
  owner?: string;
  repo?: string;
  label?: string;
  assignee?: string;
}

export interface GithubAccount extends PlatformAccountBase<"github"> {
  auth: GithubAuth;
  defaults: GithubDefaults;
}

export interface GithubMyself {
  login: string;
  id: number;
  avatarUrl?: string;
  name?: string;
  email?: string;
}

export interface GithubRepo {
  id: number;
  nodeId: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  description?: string;
  htmlUrl: string;
}

export interface GithubLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

export interface GithubUser {
  id: number;
  login: string;
  avatarUrl?: string;
}

export interface GithubCreateIssuePayload {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}

export interface GithubCreateIssueResult {
  number: number;
  url: string;
  nodeId: string;
}

export interface GithubIssueStatus {
  number: number;
  title: string;
  state: "open" | "closed";
  stateReason?: "completed" | "reopened" | "not_planned" | null;
  htmlUrl: string;
  labels: { name: string; color: string }[];
}
