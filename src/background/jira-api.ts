import { t } from "@/i18n";
import type {
  JiraAttachmentResult,
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
import type { JiraAdfDoc } from "@/types/jira";
import type { JiraOAuthAuth } from "@/types/jira";
import { OAuthError, refreshOAuthToken, persistOAuthTokens } from "./oauth";

export class JiraError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message + extractDetail(body));
    this.name = "JiraError";
  }
}

function extractDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(b.errorMessages)) {
    parts.push(...(b.errorMessages as string[]).filter(Boolean));
  }
  if (b.errors && typeof b.errors === "object") {
    for (const [k, v] of Object.entries(b.errors as Record<string, string>)) {
      if (v) parts.push(`${k}: ${v}`);
    }
  }
  return parts.length > 0 ? `\n${parts.join("\n")}` : "";
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

let refreshInFlight: Promise<JiraOAuthAuth> | null = null;

function refreshOnce(auth: JiraOAuthAuth): Promise<JiraOAuthAuth> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshOAuthToken(auth)
    .then(async (refreshed) => {
      await persistOAuthTokens(refreshed);
      return refreshed;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function ensureFreshAuth(auth: JiraAuth): Promise<JiraAuth> {
  if (auth.kind !== "oauth") return auth;
  if (auth.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) return auth;
  return refreshOnce(auth);
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
    current = await refreshOnce(current);
    res = await doFetch(current, path, init, multipart);
    if (res.status === 401) {
      throw new OAuthError(t("oauth.error.refreshExhausted"));
    }
  }
  return res;
}

async function readErrorBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return undefined;
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
  if (status === 401) return t("jira.error.401");
  if (status === 403) return t("jira.error.403");
  if (status === 404) return t("jira.error.404");
  if (status === 429) return t("jira.error.429");
  if (status >= 500) return t("jira.error.5xx");
  return t("jira.error.generic", { status });
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
): Promise<JiraAttachmentResult[]> {
  const form = new FormData();
  form.append("file", blob, filename);
  return jiraMultipart<JiraAttachmentResult[]>(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
    form,
  );
}

export async function updateIssueDescription(
  auth: JiraAuth,
  issueKey: string,
  description: JiraAdfDoc,
): Promise<void> {
  await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    {
      method: "PUT",
      body: JSON.stringify({ fields: { description } }),
    },
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

export async function getIssueStatus(
  auth: JiraAuth,
  issueKey: string,
): Promise<{ name: string; categoryKey: string }> {
  const res = await jiraFetch<{
    fields: { status: { name: string; statusCategory: { key: string } } };
  }>(auth, `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`);
  return {
    name: res.fields.status.name,
    categoryKey: res.fields.status.statusCategory.key,
  };
}

export async function searchEpics(
  auth: JiraAuth,
  projectKey: string,
  query?: string,
  hierarchyLevels?: number[],
): Promise<JiraIssueSummary[]> {
  const jqlEsc = (s: string) => s.replace(/'/g, "''");
  const conditions = [`project = '${jqlEsc(projectKey)}'`];
  if (hierarchyLevels && hierarchyLevels.length > 0) {
    conditions.push(`hierarchyLevel in (${hierarchyLevels.join(", ")})`);
  }
  if (query) {
    const q = jqlEsc(query);
    const keyMatch = /^([A-Z]+-)?(\d+)$/i.exec(query.trim());
    if (keyMatch) {
      const fullKey = keyMatch[1]
        ? q.toUpperCase()
        : `${jqlEsc(projectKey)}-${keyMatch[2]}`;
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
