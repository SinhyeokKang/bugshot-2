import { t } from "@/i18n";
import type {
  LinearAuth,
  LinearCreateIssuePayload,
  LinearCreateIssueResult,
  LinearIssueStatus,
  LinearLabel,
  LinearMyself,
  LinearProject,
  LinearTeam,
  LinearUser,
} from "@/types/linear";
import { OAuthError } from "./oauth";

export class LinearError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "LinearError";
  }
}

const GRAPHQL_URL = "https://api.linear.app/graphql";

export function buildLinearAuthHeader(auth: LinearAuth): string {
  if (auth.kind === "apiKey") return auth.apiKey;
  return `Bearer ${auth.accessToken}`;
}

export function extractLinearErrors(
  errors: Array<{ message?: string; extensions?: unknown }>,
): string {
  return errors
    .map((e) => e.message ?? "Unknown GraphQL error")
    .join("\n");
}

export function messageForLinearStatus(status: number): string {
  if (status === 401) return t("linear.error.401");
  if (status === 403) return t("linear.error.403");
  if (status === 404) return t("linear.error.404");
  if (status === 429) return t("linear.error.429");
  if (status >= 500) return t("linear.error.5xx");
  return t("linear.error.generic", { status });
}

const TOKEN_REFRESH_THRESHOLD_MS = 60_000;

let refreshHook: ((auth: LinearAuth) => Promise<LinearAuth>) | null = null;

export function setLinearRefreshHook(
  hook: ((auth: LinearAuth) => Promise<LinearAuth>) | null,
): void {
  refreshHook = hook;
}

async function ensureFresh(auth: LinearAuth): Promise<LinearAuth> {
  if (auth.kind !== "oauth" || !refreshHook) return auth;
  if (auth.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) return auth;
  return refreshHook(auth);
}

async function doFetch(
  auth: LinearAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Response> {
  return fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildLinearAuthHeader(auth),
    },
    body: JSON.stringify({ query, variables }),
  });
}

async function authedGraphQL(
  auth: LinearAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Response> {
  let cur = await ensureFresh(auth);
  let res = await doFetch(cur, query, variables);
  if (res.status === 401 && cur.kind === "oauth" && refreshHook) {
    cur = await refreshHook(cur);
    res = await doFetch(cur, query, variables);
    if (res.status === 401) {
      throw new OAuthError(t("oauth.error.refreshExhausted"), {
        platform: "linear",
      });
    }
  }
  return res;
}

export async function linearGraphQL<T>(
  auth: LinearAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await authedGraphQL(auth, query, variables);
  if (!res.ok) {
    throw new LinearError(
      res.status,
      messageForLinearStatus(res.status),
    );
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message?: string; extensions?: unknown }>;
  };
  if (json.errors?.length) {
    throw new LinearError(200, extractLinearErrors(json.errors), json.errors);
  }
  return json.data as T;
}

export async function getMyself(auth: LinearAuth): Promise<LinearMyself> {
  const data = await linearGraphQL<{
    viewer: { id: string; name: string; email?: string; avatarUrl?: string };
  }>(auth, `{ viewer { id name email avatarUrl } }`);
  return data.viewer;
}

export async function getTeams(auth: LinearAuth): Promise<LinearTeam[]> {
  const data = await linearGraphQL<{
    teams: { nodes: LinearTeam[] };
  }>(auth, `{ teams { nodes { id name key } } }`);
  return data.teams.nodes;
}

export async function getProjects(
  auth: LinearAuth,
  teamId: string,
): Promise<LinearProject[]> {
  const data = await linearGraphQL<{
    team: { projects: { nodes: LinearProject[] } };
  }>(
    auth,
    `query($teamId: String!) {
      team(id: $teamId) {
        projects {
          nodes { id name state }
        }
      }
    }`,
    { teamId },
  );
  return data.team.projects.nodes;
}

export async function getLabels(
  auth: LinearAuth,
  teamId: string,
): Promise<LinearLabel[]> {
  const data = await linearGraphQL<{
    team: { labels: { nodes: LinearLabel[] } };
  }>(
    auth,
    `query($teamId: String!) {
      team(id: $teamId) {
        labels {
          nodes { id name color }
        }
      }
    }`,
    { teamId },
  );
  return data.team.labels.nodes;
}

export async function getMembers(
  auth: LinearAuth,
  teamId: string,
): Promise<LinearUser[]> {
  const data = await linearGraphQL<{
    team: { members: { nodes: Array<{ id: string; name: string; email?: string; avatarUrl?: string }> } };
  }>(
    auth,
    `query($teamId: String!) {
      team(id: $teamId) {
        members { nodes { id name email avatarUrl } }
      }
    }`,
    { teamId },
  );
  return data.team.members.nodes;
}

export async function createIssue(
  auth: LinearAuth,
  payload: LinearCreateIssuePayload,
): Promise<LinearCreateIssueResult> {
  const input: Record<string, unknown> = {
    teamId: payload.teamId,
    title: payload.title,
    description: payload.description,
  };
  if (payload.projectId) input.projectId = payload.projectId;
  if (payload.assigneeId) input.assigneeId = payload.assigneeId;
  if (payload.labelId) input.labelIds = [payload.labelId];
  if (payload.priority != null) input.priority = payload.priority;
  const data = await linearGraphQL<{
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string; url: string };
    };
  }>(
    auth,
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    { input },
  );
  return data.issueCreate.issue;
}

export async function getIssueStatus(
  auth: LinearAuth,
  issueId: string,
): Promise<LinearIssueStatus> {
  const data = await linearGraphQL<{
    issue: {
      identifier: string;
      title: string;
      state: { name: string; type: string };
      url: string;
      labels: { nodes: Array<{ name: string; color: string }> };
    };
  }>(
    auth,
    `query($issueId: String!) {
      issue(id: $issueId) {
        identifier title url
        state { name type }
        labels { nodes { name color } }
      }
    }`,
    { issueId },
  );
  return {
    identifier: data.issue.identifier,
    title: data.issue.title,
    state: data.issue.state,
    url: data.issue.url,
    labels: data.issue.labels.nodes,
  };
}
