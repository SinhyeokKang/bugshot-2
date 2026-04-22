import type {
  JiraAuth,
  JiraCreateIssuePayload,
  JiraCreateIssueResult,
  JiraIssueSummary,
  JiraIssueType,
  JiraMyself,
  JiraPriority,
  JiraProject,
  JiraUser,
} from "@/types/jira";
import { refreshOAuthToken, persistOAuthTokens } from "./oauth";

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

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function authHeader(auth: JiraAuth): string {
  if (auth.kind === "apiKey") {
    return `Basic ${btoa(`${auth.email}:${auth.apiToken}`)}`;
  }
  return `Bearer ${auth.accessToken}`;
}

function resolveUrl(auth: JiraAuth, path: string): string {
  if (auth.kind === "apiKey") {
    return `${normalizeBaseUrl(auth.baseUrl)}${path}`;
  }
  return `https://api.atlassian.com/ex/jira/${auth.cloudId}${path}`;
}

const TOKEN_REFRESH_THRESHOLD_MS = 60_000;

async function ensureFreshAuth(auth: JiraAuth): Promise<JiraAuth> {
  if (auth.kind !== "oauth") return auth;
  if (auth.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) return auth;
  const refreshed = await refreshOAuthToken(auth);
  await persistOAuthTokens(refreshed);
  return refreshed;
}

async function authedFetch(
  auth: JiraAuth,
  path: string,
  init: RequestInit,
  multipart: boolean,
): Promise<Response> {
  let current = await ensureFreshAuth(auth);
  let res = await doFetch(current, path, init, multipart);
  if (res.status === 401 && current.kind === "oauth") {
    const refreshed = await refreshOAuthToken(current);
    await persistOAuthTokens(refreshed);
    current = refreshed;
    res = await doFetch(current, path, init, multipart);
  }
  return res;
}

async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return undefined;
    }
  }
}

export async function jiraFetch<T = unknown>(
  auth: JiraAuth,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await authedFetch(auth, path, init, false);
  if (!res.ok) {
    throw new JiraError(res.status, messageFor(res.status), await readErrorBody(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function jiraMultipart<T = unknown>(
  auth: JiraAuth,
  path: string,
  form: FormData,
): Promise<T> {
  const res = await authedFetch(auth, path, { method: "POST", body: form }, true);
  if (!res.ok) {
    throw new JiraError(res.status, messageFor(res.status), await readErrorBody(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function doFetch(
  auth: JiraAuth,
  path: string,
  init: RequestInit,
  multipart: boolean,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: authHeader(auth),
  };
  if (multipart) {
    headers["X-Atlassian-Token"] = "no-check";
  } else {
    headers["Content-Type"] = "application/json";
  }
  return fetch(resolveUrl(auth, path), {
    ...init,
    headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
  });
}

function messageFor(status: number): string {
  if (status === 401) return "인증 실패: 자격 증명을 확인하세요.";
  if (status === 403) return "권한 없음: 계정 권한을 확인하세요.";
  if (status === 404) return "찾을 수 없음: workspace URL 또는 사이트를 확인하세요.";
  if (status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
  if (status >= 500) return "Jira 서버 오류. 잠시 후 다시 시도하세요.";
  return `Jira 요청 실패 (${status})`;
}

export function getMyself(auth: JiraAuth): Promise<JiraMyself> {
  return jiraFetch<JiraMyself>(auth, "/rest/api/3/myself");
}

interface ProjectSearchResponse {
  values: JiraProject[];
  total: number;
  startAt: number;
  isLast?: boolean;
}

export async function searchProjects(
  auth: JiraAuth,
  query?: string,
): Promise<JiraProject[]> {
  const params = new URLSearchParams({ maxResults: "50" });
  if (query) params.set("query", query);
  const res = await jiraFetch<ProjectSearchResponse>(
    auth,
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
  auth: JiraAuth,
  projectKey: string,
): Promise<JiraIssueType[]> {
  const res = await jiraFetch<IssueTypesResponse>(
    auth,
    `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
  );
  return (res.issueTypes ?? []).filter((t) => !t.subtask);
}

export async function getPriorities(
  auth: JiraAuth,
): Promise<JiraPriority[]> {
  return jiraFetch<JiraPriority[]>(auth, "/rest/api/3/priority");
}

export async function searchUsers(
  auth: JiraAuth,
  query?: string,
): Promise<JiraUser[]> {
  const params = new URLSearchParams({
    query: query || "",
    maxResults: "50",
  });
  return jiraFetch<JiraUser[]>(
    auth,
    `/rest/api/3/user/search?${params.toString()}`,
  );
}

interface JiraSearchResponse {
  issues: JiraIssueSummary[];
  total: number;
}

export async function createIssue(
  auth: JiraAuth,
  payload: JiraCreateIssuePayload,
): Promise<JiraCreateIssueResult> {
  const fields: Record<string, unknown> = {
    project: { key: payload.projectKey },
    summary: payload.summary,
    description: payload.description,
    issuetype: { id: payload.issueTypeId },
  };
  if (payload.assigneeAccountId) {
    fields.assignee = { accountId: payload.assigneeAccountId };
  }
  if (payload.priorityId) {
    fields.priority = { id: payload.priorityId };
  }
  if (payload.parentKey) {
    fields.parent = { key: payload.parentKey };
  }
  return jiraFetch<JiraCreateIssueResult>(auth, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

export async function uploadAttachment(
  auth: JiraAuth,
  issueKey: string,
  filename: string,
  blob: Blob,
): Promise<unknown> {
  const form = new FormData();
  form.append("file", blob, filename);
  return jiraMultipart(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
    form,
  );
}

export async function createIssueLink(
  auth: JiraAuth,
  inwardKey: string,
  outwardKey: string,
  linkTypeName = "Relates",
): Promise<void> {
  await jiraFetch(auth, "/rest/api/3/issueLink", {
    method: "POST",
    body: JSON.stringify({
      type: { name: linkTypeName },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    }),
  });
}

export async function searchEpics(
  auth: JiraAuth,
  projectKey: string,
  query?: string,
): Promise<JiraIssueSummary[]> {
  const conditions = [
    `project = '${projectKey}'`,
    `hierarchyLevel in (0, 1)`,
  ];
  if (query) {
    const q = query.replace(/'/g, "\\'");
    const keyMatch = /^([A-Z]+-)?(\d+)$/i.exec(query.trim());
    if (keyMatch) {
      const fullKey = keyMatch[1]
        ? q.toUpperCase()
        : `${projectKey}-${keyMatch[2]}`;
      conditions.push(`(key = '${fullKey}' OR summary ~ '${q}')`);
    } else {
      conditions.push(`summary ~ '${q}'`);
    }
  }
  const jql = conditions.join(" AND ") + " ORDER BY updated DESC";
  const params = new URLSearchParams({
    jql,
    maxResults: "30",
    fields: "summary,issuetype",
  });
  const res = await jiraFetch<JiraSearchResponse>(
    auth,
    `/rest/api/3/search/jql?${params.toString()}`,
  );
  return res.issues;
}
