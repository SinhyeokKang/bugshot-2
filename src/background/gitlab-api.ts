import { t } from "@/i18n";
import type {
  GitlabAuth,
  GitlabCreateIssuePayload,
  GitlabCreateIssueResult,
  GitlabIssueStatus,
  GitlabLabel,
  GitlabMember,
  GitlabMyself,
  GitlabProject,
} from "@/types/gitlab";
import { OAuthError } from "./oauth";

export class GitlabError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message + extractGitlabDetail(body));
    this.name = "GitlabError";
  }
}

export function buildAuthHeader(auth: GitlabAuth): string {
  if (auth.kind === "pat") return `Bearer ${auth.pat}`;
  return `Bearer ${auth.accessToken}`;
}

export function extractGitlabDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof b.message === "string") parts.push(b.message);
  else if (b.message && typeof b.message === "object") {
    for (const v of Object.values(b.message as Record<string, unknown>)) {
      if (Array.isArray(v)) parts.push(...v.map(String));
      else if (typeof v === "string") parts.push(v);
    }
  }
  if (typeof b.error === "string") parts.push(b.error);
  if (typeof b.error_description === "string") parts.push(b.error_description);
  return parts.length ? `\n${parts.join("\n")}` : "";
}

export function mapCreateIssueBody(
  payload: GitlabCreateIssuePayload,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: payload.title,
    description: payload.description,
  };
  if (payload.labels?.length) body.labels = payload.labels.join(",");
  if (payload.assigneeIds?.length) body.assignee_ids = payload.assigneeIds;
  return body;
}

export function messageForGitlabStatus(status: number): string {
  if (status === 401) return t("gitlab.error.401");
  if (status === 403) return t("gitlab.error.403");
  if (status === 404) return t("gitlab.error.404");
  if (status === 422) return t("gitlab.error.422");
  if (status === 429) return t("gitlab.error.429");
  if (status >= 500) return t("gitlab.error.5xx");
  return t("gitlab.error.generic", { status });
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

async function doFetch(
  auth: GitlabAuth,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: buildAuthHeader(auth),
  };
  if (init.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, {
    ...init,
    cache: "no-cache",
    headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
  });
}

const TOKEN_REFRESH_THRESHOLD_MS = 60_000;

let refreshHook: ((auth: GitlabAuth) => Promise<GitlabAuth>) | null = null;

export function setGitlabRefreshHook(
  hook: ((auth: GitlabAuth) => Promise<GitlabAuth>) | null,
): void {
  refreshHook = hook;
}

async function ensureFresh(auth: GitlabAuth): Promise<GitlabAuth> {
  if (auth.kind !== "oauth" || !refreshHook) return auth;
  if (auth.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) return auth;
  return refreshHook(auth);
}

async function authedFetch(
  auth: GitlabAuth,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let cur = await ensureFresh(auth);
  let res = await doFetch(cur, url, init);
  if (res.status === 401 && cur.kind === "oauth" && refreshHook) {
    cur = await refreshHook(cur);
    res = await doFetch(cur, url, init);
    if (res.status === 401) {
      throw new OAuthError(t("oauth.error.refreshExhausted"), {
        platform: "gitlab",
      });
    }
  }
  return res;
}

export async function gitlabFetch<T = unknown>(
  auth: GitlabAuth,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("https://")
    ? path
    : `${auth.baseUrl}/api/v4${path}`;
  const res = await authedFetch(auth, url, init);
  if (!res.ok) {
    throw new GitlabError(
      res.status,
      messageForGitlabStatus(res.status),
      await readErrorBody(res),
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface RawProject {
  id: number;
  name: string;
  path_with_namespace: string;
  name_with_namespace: string;
  web_url: string;
}

export function normalizeProject(raw: RawProject): GitlabProject {
  return {
    id: raw.id,
    pathWithNamespace: raw.path_with_namespace,
    name: raw.name,
    nameWithNamespace: raw.name_with_namespace,
    webUrl: raw.web_url,
  };
}

export async function getMyself(auth: GitlabAuth): Promise<GitlabMyself> {
  const raw = await gitlabFetch<{
    id: number;
    username: string;
    name: string;
    email?: string | null;
    avatar_url?: string | null;
  }>(auth, "/user");
  return {
    id: raw.id,
    username: raw.username,
    name: raw.name,
    email: raw.email ?? undefined,
    avatarUrl: raw.avatar_url ?? undefined,
  };
}

export async function searchProjects(
  auth: GitlabAuth,
  query: string,
): Promise<GitlabProject[]> {
  const params = new URLSearchParams({
    membership: "true",
    order_by: "last_activity_at",
    per_page: "30",
    min_access_level: "20",
  });
  const q = query.trim();
  if (q) params.set("search", q);
  const list = await gitlabFetch<RawProject[]>(
    auth,
    `/projects?${params.toString()}`,
  );
  return list.map(normalizeProject);
}

export async function getProjectLabels(
  auth: GitlabAuth,
  projectId: number,
): Promise<GitlabLabel[]> {
  const list = await gitlabFetch<
    Array<{ id: number; name: string; color: string; description?: string | null }>
  >(auth, `/projects/${projectId}/labels?per_page=100`);
  return list.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    description: l.description ?? undefined,
  }));
}

export async function getProjectMembers(
  auth: GitlabAuth,
  projectId: number,
): Promise<GitlabMember[]> {
  const list = await gitlabFetch<
    Array<{ id: number; username: string; name: string; avatar_url?: string | null }>
  >(auth, `/projects/${projectId}/members/all?per_page=100`);
  return list.map((m) => ({
    id: m.id,
    username: m.username,
    name: m.name,
    avatarUrl: m.avatar_url ?? undefined,
  }));
}

export async function createIssue(
  auth: GitlabAuth,
  payload: GitlabCreateIssuePayload,
): Promise<GitlabCreateIssueResult> {
  const raw = await gitlabFetch<{ iid: number; id: number; web_url: string }>(
    auth,
    `/projects/${payload.projectId}/issues`,
    { method: "POST", body: JSON.stringify(mapCreateIssueBody(payload)) },
  );
  return { iid: raw.iid, id: raw.id, url: raw.web_url };
}

export async function uploadFile(
  auth: GitlabAuth,
  projectId: number,
  filename: string,
  blob: Blob,
): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", blob, filename);
  const raw = await gitlabFetch<{ url: string }>(
    auth,
    `/projects/${projectId}/uploads`,
    { method: "POST", body: form },
  );
  return { url: raw.url };
}

interface RawIssue {
  iid: number;
  title: string;
  state: "opened" | "closed";
  web_url: string;
  labels?: string[];
}

export function normalizeIssueStatus(raw: RawIssue): GitlabIssueStatus {
  return {
    iid: raw.iid,
    title: raw.title,
    state: raw.state,
    webUrl: raw.web_url,
    labels: raw.labels ?? [],
  };
}

export async function getIssueStatus(
  auth: GitlabAuth,
  projectId: number,
  iid: number,
): Promise<GitlabIssueStatus> {
  const raw = await gitlabFetch<RawIssue>(
    auth,
    `/projects/${projectId}/issues/${iid}`,
  );
  return normalizeIssueStatus(raw);
}

export async function updateIssueDescription(
  auth: GitlabAuth,
  projectId: number,
  iid: number,
  description: string,
): Promise<void> {
  await gitlabFetch(auth, `/projects/${projectId}/issues/${iid}`, {
    method: "PUT",
    body: JSON.stringify({ description }),
  });
}

export async function updateIssueState(
  auth: GitlabAuth,
  projectId: number,
  iid: number,
  state: "opened" | "closed",
): Promise<GitlabIssueStatus> {
  const raw = await gitlabFetch<RawIssue>(
    auth,
    `/projects/${projectId}/issues/${iid}`,
    {
      method: "PUT",
      body: JSON.stringify({
        state_event: state === "closed" ? "close" : "reopen",
      }),
    },
  );
  return normalizeIssueStatus(raw);
}
