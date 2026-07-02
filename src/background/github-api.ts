import { t } from "@/i18n";
import { readErrorBody } from "./lib/readErrorBody";
import type {
  GithubAuth,
  GithubCreateIssuePayload,
  GithubCreateIssueResult,
  GithubIssueStatus,
  GithubLabel,
  GithubMyself,
  GithubRepo,
  GithubUser,
} from "@/types/github";
import { createRefreshRunner } from "./lib/createRefreshRunner";

export class GithubError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message + extractGithubDetail(body));
    this.name = "GithubError";
  }
}

const USER_AGENT = "bugshot-2";

export function buildAuthHeader(auth: GithubAuth): string {
  if (auth.kind === "pat") return `token ${auth.pat}`;
  return `Bearer ${auth.accessToken}`;
}

export function extractGithubDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof b.message === "string") parts.push(b.message);
  if (Array.isArray(b.errors)) {
    for (const e of b.errors) {
      if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        const msg = (o.message ?? o.code ?? "").toString();
        if (msg) parts.push(msg);
      } else if (typeof e === "string") {
        parts.push(e);
      }
    }
  }
  return parts.length ? `\n${parts.join("\n")}` : "";
}

export function mapCreateIssueBody(
  payload: GithubCreateIssuePayload,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: payload.title,
    body: payload.body,
  };
  if (payload.labels?.length) body.labels = payload.labels;
  if (payload.assignees?.length) body.assignees = payload.assignees;
  return body;
}

export function messageForGithubStatus(status: number): string {
  if (status === 401) return t("github.error.401");
  if (status === 403) return t("github.error.403");
  if (status === 404) return t("github.error.404");
  if (status === 422) return t("github.error.422");
  if (status === 429) return t("github.error.429");
  if (status >= 500) return t("github.error.5xx");
  return t("github.error.generic", { status });
}

async function doFetch(
  auth: GithubAuth,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
    Authorization: buildAuthHeader(auth),
  };
  if (init.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, {
    ...init,
    // GitHub API는 짧은 max-age를 주는 응답이 있어 default 캐시 모드면 stale을 받을 수 있다.
    // no-cache로 두면 매 요청마다 ETag revalidate — 변경 시 200, 미변경 시 304.
    cache: "no-cache",
    headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
  });
}

const refreshRunner = createRefreshRunner<GithubAuth>({ platform: "github" });

export const setGithubRefreshHook = refreshRunner.setRefreshHook;

async function authedFetch(
  auth: GithubAuth,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return refreshRunner.runWithAuthRetry(auth, (cur) => doFetch(cur, url, init));
}

export async function githubFetch<T = unknown>(
  auth: GithubAuth,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("https://") ? path : `https://api.github.com${path}`;
  const res = await authedFetch(auth, url, init);
  if (!res.ok) {
    throw new GithubError(
      res.status,
      messageForGithubStatus(res.status),
      await readErrorBody(res),
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface RawRepo {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
  html_url: string;
}

export function normalizeRepo(raw: RawRepo): GithubRepo {
  return {
    id: raw.id,
    nodeId: raw.node_id,
    name: raw.name,
    fullName: raw.full_name,
    owner: raw.owner.login,
    private: raw.private,
    description: raw.description ?? undefined,
    htmlUrl: raw.html_url,
  };
}

export async function getMyself(auth: GithubAuth): Promise<GithubMyself> {
  const raw = await githubFetch<{
    login: string;
    id: number;
    avatar_url?: string;
    name?: string | null;
    email?: string | null;
  }>(auth, "/user");
  let email = raw.email ?? undefined;
  if (!email) {
    try {
      const emails = await githubFetch<{ email: string; primary: boolean }[]>(
        auth,
        "/user/emails",
      );
      email = emails.find((e) => e.primary)?.email;
    } catch {
      // user:email scope 없거나 실패 시 무시
    }
  }
  return {
    login: raw.login,
    id: raw.id,
    avatarUrl: raw.avatar_url,
    name: raw.name ?? undefined,
    email,
  };
}

interface RepoSearchResponse {
  items: RawRepo[];
}

export async function searchRepos(
  auth: GithubAuth,
  query: string,
): Promise<GithubRepo[]> {
  const q = query.trim();
  if (!q) {
    // 빈 쿼리: 사용자 본인 보유 repo 최근 push 순.
    const list = await githubFetch<RawRepo[]>(
      auth,
      "/user/repos?per_page=30&sort=pushed",
    );
    return list.map(normalizeRepo);
  }
  const params = new URLSearchParams({
    q: `${q} in:name`,
    per_page: "30",
    sort: "updated",
  });
  const res = await githubFetch<RepoSearchResponse>(
    auth,
    `/search/repositories?${params.toString()}`,
  );
  return res.items.map(normalizeRepo);
}

export async function getRepoLabels(
  auth: GithubAuth,
  owner: string,
  repo: string,
): Promise<GithubLabel[]> {
  const list = await githubFetch<
    Array<{
      id: number;
      name: string;
      color: string;
      description: string | null;
    }>
  >(
    auth,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels?per_page=100`,
  );
  return list.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    description: l.description ?? undefined,
  }));
}

export async function getRepoAssignees(
  auth: GithubAuth,
  owner: string,
  repo: string,
): Promise<GithubUser[]> {
  const list = await githubFetch<
    Array<{ id: number; login: string; avatar_url?: string }>
  >(
    auth,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/assignees?per_page=100`,
  );
  return list.map((u) => ({
    id: u.id,
    login: u.login,
    avatarUrl: u.avatar_url,
  }));
}

interface RawIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  state_reason?: "completed" | "reopened" | "not_planned" | null;
  html_url: string;
  labels: Array<string | { name: string; color: string }>;
}

export function normalizeIssueStatus(raw: RawIssue): GithubIssueStatus {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    stateReason: raw.state_reason ?? null,
    htmlUrl: raw.html_url,
    labels: raw.labels
      .map((l) => (typeof l === "string" ? { name: l, color: "" } : { name: l.name, color: l.color }))
      .filter((l) => !!l.name),
  };
}

export async function getIssueStatus(
  auth: GithubAuth,
  owner: string,
  repo: string,
  number: number,
): Promise<GithubIssueStatus> {
  const raw = await githubFetch<RawIssue>(
    auth,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
  );
  return normalizeIssueStatus(raw);
}

export async function updateIssueState(
  auth: GithubAuth,
  owner: string,
  repo: string,
  number: number,
  state: "open" | "closed",
  stateReason?: "completed" | "not_planned" | null,
): Promise<GithubIssueStatus> {
  const body: Record<string, unknown> = { state };
  if (state === "closed" && stateReason) {
    body.state_reason = stateReason;
  } else if (state === "open") {
    body.state_reason = "reopened";
  }
  const raw = await githubFetch<RawIssue>(
    auth,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  return normalizeIssueStatus(raw);
}

export async function createIssue(
  auth: GithubAuth,
  payload: GithubCreateIssuePayload,
): Promise<GithubCreateIssueResult> {
  const raw = await githubFetch<{
    number: number;
    html_url: string;
    node_id: string;
  }>(
    auth,
    `/repos/${encodeURIComponent(payload.owner)}/${encodeURIComponent(payload.repo)}/issues`,
    {
      method: "POST",
      body: JSON.stringify(mapCreateIssueBody(payload)),
    },
  );
  return {
    number: raw.number,
    url: raw.html_url,
    nodeId: raw.node_id,
  };
}
