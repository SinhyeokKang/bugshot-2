import { t } from "@/i18n";
import { readErrorBody } from "./lib/readErrorBody";
import type {
  ClickupAuth,
  ClickupCreateTaskPayload,
  ClickupCreateTaskResult,
  ClickupList,
  ClickupMyself,
  ClickupSpace,
  ClickupTaskStatus,
  ClickupUser,
  ClickupWorkspace,
} from "@/types/clickup";

const API_BASE = "https://api.clickup.com/api/v2";

export class ClickupError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message + extractClickupDetail(body));
    this.name = "ClickupError";
  }
}

// ClickUp은 PAT/OAuth 모두 raw token(`Authorization: <token>`, Bearer 접두사 없음).
export function clickupAuthHeader(auth: ClickupAuth): Record<string, string> {
  return { Authorization: auth.kind === "pat" ? auth.pat : auth.accessToken };
}

export function extractClickupDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof b.err === "string") parts.push(b.err);
  if (typeof b.error === "string") parts.push(b.error);
  if (typeof b.ECODE === "string") parts.push(b.ECODE);
  return parts.length ? `\n${parts.join("\n")}` : "";
}

export function messageForClickupStatus(status: number): string {
  if (status === 401) return t("clickup.oauthRevoked");
  if (status === 403) return t("clickup.error.403");
  if (status === 404) return t("clickup.error.404");
  if (status === 429) return t("clickup.error.429");
  if (status >= 500) return t("clickup.error.5xx");
  return t("clickup.error.generic", { status });
}

export async function clickupFetch<T = unknown>(
  auth: ClickupAuth,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...clickupAuthHeader(auth),
  };
  if (init.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    ...init,
    cache: "no-cache",
    headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) {
    // ClickUp 토큰은 만료가 없어 refresh가 없다 → 401은 곧 권한 박탈/revoke. 곧장 재연결 에러.
    throw new ClickupError(
      res.status,
      messageForClickupStatus(res.status),
      await readErrorBody(res),
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getMyself(auth: ClickupAuth): Promise<ClickupMyself> {
  const raw = await clickupFetch<{
    user: { id: number | string; username: string; email?: string | null };
  }>(auth, "/user");
  return {
    id: String(raw.user.id),
    name: raw.user.username,
    email: raw.user.email ?? undefined,
  };
}

export async function getTeams(auth: ClickupAuth): Promise<ClickupWorkspace[]> {
  const raw = await clickupFetch<{ teams: Array<{ id: string; name: string }> }>(
    auth,
    "/team",
  );
  return raw.teams.map((tm) => ({ id: tm.id, name: tm.name }));
}

export async function getSpaces(
  auth: ClickupAuth,
  teamId: string,
): Promise<ClickupSpace[]> {
  const raw = await clickupFetch<{ spaces: Array<{ id: string; name: string }> }>(
    auth,
    `/team/${teamId}/space?archived=false`,
  );
  return raw.spaces.map((s) => ({ id: s.id, name: s.name }));
}

// folderless list와 folder 하위 list를 하나의 평면 목록으로 합친다 (folder는 라벨로만 표기).
export function flattenLists(
  folderless: Array<{ id: string; name: string }>,
  folders: Array<{ name: string; lists: Array<{ id: string; name: string }> }>,
): ClickupList[] {
  const out: ClickupList[] = folderless.map((l) => ({ id: l.id, name: l.name }));
  for (const folder of folders) {
    for (const l of folder.lists) {
      out.push({ id: l.id, name: l.name, folderName: folder.name });
    }
  }
  return out;
}

export async function getLists(
  auth: ClickupAuth,
  spaceId: string,
): Promise<ClickupList[]> {
  const [folderlessRaw, foldersRaw] = await Promise.all([
    clickupFetch<{ lists: Array<{ id: string; name: string }> }>(
      auth,
      `/space/${spaceId}/list?archived=false`,
    ),
    clickupFetch<{
      folders: Array<{ name: string; lists: Array<{ id: string; name: string }> }>;
    }>(auth, `/space/${spaceId}/folder?archived=false`),
  ]);
  return flattenLists(folderlessRaw.lists, foldersRaw.folders);
}

export async function getMembers(
  auth: ClickupAuth,
  teamId: string,
): Promise<ClickupUser[]> {
  // 멤버는 GET /team 응답의 각 team.members에 들어 있다 (멤버 전용 엔드포인트 부재).
  const raw = await clickupFetch<{
    teams: Array<{
      id: string;
      members: Array<{ user: { id: number | string; username: string; email?: string | null } }>;
    }>;
  }>(auth, "/team");
  const team = raw.teams.find((tm) => tm.id === teamId);
  if (!team) return [];
  return team.members.map((m) => ({
    id: String(m.user.id),
    name: m.user.username,
    email: m.user.email ?? undefined,
  }));
}

export function mapCreateTaskBody(
  payload: ClickupCreateTaskPayload,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: payload.name,
    markdown_content: payload.markdownContent,
  };
  if (payload.assignees && payload.assignees.length > 0) {
    body.assignees = payload.assignees.map((id) => Number(id));
  }
  return body;
}

export async function createTask(
  auth: ClickupAuth,
  payload: ClickupCreateTaskPayload,
): Promise<ClickupCreateTaskResult> {
  const raw = await clickupFetch<{ id: string; url: string }>(
    auth,
    `/list/${payload.listId}/task`,
    { method: "POST", body: JSON.stringify(mapCreateTaskBody(payload)) },
  );
  return { id: raw.id, url: raw.url };
}

export async function uploadAttachment(
  auth: ClickupAuth,
  taskId: string,
  filename: string,
  blob: Blob,
): Promise<{ url?: string }> {
  const form = new FormData();
  form.append("attachment", blob, filename);
  const raw = await clickupFetch<{ url?: string }>(
    auth,
    `/task/${taskId}/attachment`,
    { method: "POST", body: form },
  );
  return { url: raw.url ?? undefined };
}

export async function updateTaskMarkdown(
  auth: ClickupAuth,
  taskId: string,
  markdownContent: string,
): Promise<void> {
  await clickupFetch(auth, `/task/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ markdown_content: markdownContent }),
  });
}

interface RawTask {
  id: string;
  name: string;
  url: string;
  status?: { status: string; type: string };
  list?: { id: string };
}

function isCompletedStatus(status?: { type: string }): boolean {
  return status?.type === "done" || status?.type === "closed";
}

export function normalizeTaskStatus(raw: RawTask): ClickupTaskStatus {
  return {
    id: raw.id,
    name: raw.name,
    completed: isCompletedStatus(raw.status),
    url: raw.url,
  };
}

export async function getTaskStatus(
  auth: ClickupAuth,
  taskId: string,
): Promise<ClickupTaskStatus> {
  const raw = await clickupFetch<RawTask>(auth, `/task/${taskId}`);
  return normalizeTaskStatus(raw);
}

// ClickUp은 완료 boolean이 없고 List별 커스텀 status를 쓴다 → list의 done/non-done status로 매핑해 PUT.
export async function setTaskCompleted(
  auth: ClickupAuth,
  taskId: string,
  completed: boolean,
): Promise<ClickupTaskStatus> {
  const task = await clickupFetch<RawTask>(auth, `/task/${taskId}`);
  const listId = task.list?.id;
  let targetStatus: string | undefined;
  if (listId) {
    const list = await clickupFetch<{
      statuses?: Array<{ status: string; type: string }>;
    }>(auth, `/list/${listId}`);
    const statuses = list.statuses ?? [];
    targetStatus = completed
      ? statuses.find((s) => s.type === "done" || s.type === "closed")?.status
      : statuses.find((s) => s.type !== "done" && s.type !== "closed")?.status;
  }
  if (!targetStatus) {
    throw new ClickupError(400, t("clickup.error.statusMappingFailed"));
  }
  const raw = await clickupFetch<RawTask>(auth, `/task/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ status: targetStatus }),
  });
  return normalizeTaskStatus(raw);
}
