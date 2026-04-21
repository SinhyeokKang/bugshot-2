import type {
  JiraConfigPayload,
  JiraIssueSummary,
  JiraIssueType,
  JiraMyself,
  JiraPriority,
  JiraProject,
  JiraUser,
} from "@/types/jira";

export class JiraError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "JiraError";
  }
}

function authHeader(cfg: JiraConfigPayload): string {
  return `Basic ${btoa(`${cfg.email}:${cfg.apiToken}`)}`;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function jiraFetch<T = unknown>(
  cfg: JiraConfigPayload,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      Authorization: authHeader(cfg),
    },
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        body = undefined;
      }
    }
    throw new JiraError(res.status, messageFor(res.status), body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function messageFor(status: number): string {
  if (status === 401) return "인증 실패: 이메일 또는 API 토큰을 확인하세요.";
  if (status === 403) return "권한 없음: API 토큰의 권한을 확인하세요.";
  if (status === 404) return "찾을 수 없음: workspace URL을 확인하세요.";
  if (status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
  if (status >= 500) return "Jira 서버 오류. 잠시 후 다시 시도하세요.";
  return `Jira 요청 실패 (${status})`;
}

export function getMyself(cfg: JiraConfigPayload): Promise<JiraMyself> {
  return jiraFetch<JiraMyself>(cfg, "/rest/api/3/myself");
}

interface ProjectSearchResponse {
  values: JiraProject[];
  total: number;
  startAt: number;
  isLast?: boolean;
}

export async function searchProjects(
  cfg: JiraConfigPayload,
  query?: string,
): Promise<JiraProject[]> {
  const params = new URLSearchParams({ maxResults: "50" });
  if (query) params.set("query", query);
  const res = await jiraFetch<ProjectSearchResponse>(
    cfg,
    `/rest/api/3/project/search?${params.toString()}`,
  );
  return res.values;
}

interface IssueTypesResponse {
  issueTypes: JiraIssueType[];
  maxResults?: number;
  startAt?: number;
  total?: number;
}

export async function getIssueTypes(
  cfg: JiraConfigPayload,
  projectKey: string,
): Promise<JiraIssueType[]> {
  const res = await jiraFetch<IssueTypesResponse>(
    cfg,
    `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
  );
  return (res.issueTypes ?? []).filter((t) => !t.subtask);
}

export async function getPriorities(
  cfg: JiraConfigPayload,
): Promise<JiraPriority[]> {
  return jiraFetch<JiraPriority[]>(cfg, "/rest/api/3/priority");
}

export async function searchUsers(
  cfg: JiraConfigPayload,
  query?: string,
): Promise<JiraUser[]> {
  const params = new URLSearchParams({
    query: query || "",
    maxResults: "50",
  });
  return jiraFetch<JiraUser[]>(
    cfg,
    `/rest/api/3/user/search?${params.toString()}`,
  );
}

interface JiraSearchResponse {
  issues: JiraIssueSummary[];
  total: number;
}

export async function searchEpics(
  cfg: JiraConfigPayload,
  projectKey: string,
  query?: string,
): Promise<JiraIssueSummary[]> {
  const jql = [
    `project = '${projectKey}'`,
    `hierarchyLevel = 0`,
    ...(query ? [`summary ~ '${query.replace(/'/g, "\\'")}'`] : []),
  ].join(" AND ") + " ORDER BY updated DESC";
  const params = new URLSearchParams({
    jql,
    maxResults: "30",
    fields: "summary,issuetype",
  });
  const res = await jiraFetch<JiraSearchResponse>(
    cfg,
    `/rest/api/3/search/jql?${params.toString()}`,
  );
  return res.issues;
}
