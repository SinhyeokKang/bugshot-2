import { t } from "@/i18n";
import { readErrorBody } from "./lib/readErrorBody";
import type {
  AsanaAuth,
  AsanaCreateTaskPayload,
  AsanaCreateTaskResult,
  AsanaMyself,
  AsanaProject,
  AsanaTaskStatus,
  AsanaUser,
  AsanaWorkspace,
} from "@/types/asana";
import { OAuthError } from "./oauth";

const API_BASE = "https://app.asana.com/api/1.0";

export class AsanaError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message + extractAsanaDetail(body));
    this.name = "AsanaError";
  }
}

export function buildAuthHeader(auth: AsanaAuth): string {
  if (auth.kind === "pat") return `Bearer ${auth.pat}`;
  return `Bearer ${auth.accessToken}`;
}

export function extractAsanaDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(b.errors)) {
    for (const e of b.errors) {
      if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
        parts.push((e as { message: string }).message);
      }
    }
  }
  if (typeof b.error === "string") parts.push(b.error);
  if (typeof b.error_description === "string") parts.push(b.error_description);
  return parts.length ? `\n${parts.join("\n")}` : "";
}

export function mapCreateTaskBody(
  payload: AsanaCreateTaskPayload,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: payload.name,
    html_notes: payload.htmlNotes,
    workspace: payload.workspaceGid,
  };
  if (payload.projectGid) data.projects = [payload.projectGid];
  if (payload.assigneeGid) data.assignee = payload.assigneeGid;
  return { data };
}

export function messageForAsanaStatus(status: number): string {
  if (status === 401) return t("asana.error.401");
  if (status === 403) return t("asana.error.403");
  if (status === 404) return t("asana.error.404");
  if (status === 429) return t("asana.error.429");
  if (status >= 500) return t("asana.error.5xx");
  return t("asana.error.generic", { status });
}

async function doFetch(
  auth: AsanaAuth,
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

let refreshHook: ((auth: AsanaAuth) => Promise<AsanaAuth>) | null = null;

export function setAsanaRefreshHook(
  hook: ((auth: AsanaAuth) => Promise<AsanaAuth>) | null,
): void {
  refreshHook = hook;
}

async function ensureFresh(auth: AsanaAuth): Promise<AsanaAuth> {
  if (auth.kind !== "oauth" || !refreshHook) return auth;
  if (auth.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) return auth;
  return refreshHook(auth);
}

async function authedFetch(
  auth: AsanaAuth,
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
        platform: "asana",
      });
    }
  }
  return res;
}

// Asana 응답은 { data: ... } 래핑 → .data 언랩.
export async function asanaFetch<T = unknown>(
  auth: AsanaAuth,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${API_BASE}${path}`;
  const res = await authedFetch(auth, url, init);
  if (!res.ok) {
    throw new AsanaError(
      res.status,
      messageForAsanaStatus(res.status),
      await readErrorBody(res),
    );
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { data: T };
  return json.data;
}

export async function getMyself(auth: AsanaAuth): Promise<AsanaMyself> {
  const raw = await asanaFetch<{ gid: string; name: string; email?: string | null }>(
    auth,
    "/users/me?opt_fields=name,email",
  );
  return { gid: raw.gid, name: raw.name, email: raw.email ?? undefined };
}

export async function getWorkspaces(auth: AsanaAuth): Promise<AsanaWorkspace[]> {
  const list = await asanaFetch<Array<{ gid: string; name: string }>>(
    auth,
    "/workspaces?opt_fields=name&limit=100",
  );
  return list.map((w) => ({ gid: w.gid, name: w.name }));
}

export async function searchProjects(
  auth: AsanaAuth,
  workspaceGid: string,
  query: string,
): Promise<AsanaProject[]> {
  // Asana /projects는 서버측 텍스트 검색이 없어 워크스페이스 프로젝트(최대 100개)를 받아 클라이언트 필터.
  const list = await asanaFetch<Array<{ gid: string; name: string }>>(
    auth,
    `/projects?workspace=${workspaceGid}&opt_fields=name&limit=100`,
  );
  const q = query.trim().toLowerCase();
  const projects = list.map((p) => ({ gid: p.gid, name: p.name }));
  return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
}

export async function searchUsers(
  auth: AsanaAuth,
  workspaceGid: string,
  query: string,
): Promise<AsanaUser[]> {
  // typeahead user는 "most contacted" 순서라 task 이력 없는 멤버(새 워크스페이스 owner 등)가 누락된다.
  // 워크스페이스 멤버(최대 100명)를 받아 클라이언트 필터 (searchProjects 패턴).
  const list = await asanaFetch<Array<{ gid: string; name: string; email?: string | null }>>(
    auth,
    `/users?workspace=${workspaceGid}&opt_fields=name,email&limit=100`,
  );
  const q = query.trim().toLowerCase();
  const users = list.map((u) => ({ gid: u.gid, name: u.name, email: u.email ?? undefined }));
  return q ? users.filter((u) => u.name.toLowerCase().includes(q)) : users;
}

export async function createTask(
  auth: AsanaAuth,
  payload: AsanaCreateTaskPayload,
): Promise<AsanaCreateTaskResult> {
  const raw = await asanaFetch<{ gid: string; permalink_url: string }>(
    auth,
    "/tasks?opt_fields=permalink_url",
    { method: "POST", body: JSON.stringify(mapCreateTaskBody(payload)) },
  );
  return { gid: raw.gid, permalinkUrl: raw.permalink_url };
}

export async function uploadAttachment(
  auth: AsanaAuth,
  taskGid: string,
  filename: string,
  blob: Blob,
): Promise<{ gid: string; viewUrl?: string }> {
  const form = new FormData();
  form.append("parent", taskGid);
  form.append("file", blob, filename);
  // view_url은 이미지 인라인(<img src>) 렌더에 필요.
  const raw = await asanaFetch<{ gid: string; view_url?: string }>(
    auth,
    "/attachments?opt_fields=view_url",
    { method: "POST", body: form },
  );
  return { gid: raw.gid, viewUrl: raw.view_url ?? undefined };
}

interface RawTask {
  gid: string;
  name: string;
  completed: boolean;
  permalink_url: string;
}

export function normalizeTaskStatus(raw: RawTask): AsanaTaskStatus {
  return {
    gid: raw.gid,
    name: raw.name,
    completed: raw.completed,
    permalinkUrl: raw.permalink_url,
  };
}

export async function getTaskStatus(
  auth: AsanaAuth,
  taskGid: string,
): Promise<AsanaTaskStatus> {
  const raw = await asanaFetch<RawTask>(
    auth,
    `/tasks/${taskGid}?opt_fields=name,completed,permalink_url`,
  );
  return normalizeTaskStatus(raw);
}

export async function updateTaskNotes(
  auth: AsanaAuth,
  taskGid: string,
  htmlNotes: string,
): Promise<void> {
  await asanaFetch(auth, `/tasks/${taskGid}`, {
    method: "PUT",
    body: JSON.stringify({ data: { html_notes: htmlNotes } }),
  });
}

export async function setTaskCompleted(
  auth: AsanaAuth,
  taskGid: string,
  completed: boolean,
): Promise<AsanaTaskStatus> {
  const raw = await asanaFetch<RawTask>(
    auth,
    `/tasks/${taskGid}?opt_fields=name,completed,permalink_url`,
    { method: "PUT", body: JSON.stringify({ data: { completed } }) },
  );
  return normalizeTaskStatus(raw);
}
