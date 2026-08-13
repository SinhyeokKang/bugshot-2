import { t } from "@/i18n";
import { readErrorBody } from "./lib/readErrorBody";
import type {
  JiraAttachmentResult,
  JiraAuth,
  JiraCreateIssuePayload,
  JiraCreateIssueResult,
  JiraIssueStatus,
  JiraIssueSummary,
  JiraIssueType,
  JiraMyself,
  JiraPriority,
  JiraProject,
  JiraSprint,
  JiraSprintFieldMeta,
  JiraTransition,
  JiraUser,
} from "@/types/jira";
import type { JiraAdfDoc } from "@/types/jira";
import type { JiraOAuthAuth } from "@/types/jira";
import { OAuthError, refreshOAuthToken, persistOAuthTokens } from "./oauth";
import { readStoredAuth } from "@/lib/settings-storage";
import { pickRotatedAuth } from "./lib/rotatedAuth";
import { assertCredentialSafeBase } from "@/lib/credential-url";

export class JiraError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message + extractJiraDetail(body));
    this.name = "JiraError";
  }
}

export function extractJiraDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(b.errorMessages)) {
    parts.push(...(b.errorMessages as string[]).filter(Boolean));
  }
  if (b.errors && typeof b.errors === "object") {
    for (const [k, v] of Object.entries(b.errors as Record<string, string>)) {
      if (!v) continue;
      // 담당자 배정 불가는 원문이 영문 API 문구라 무엇을 해야 할지 알 수 없다 — 안내를 앞에 붙인다.
      if (k === "assignee") {
        parts.push(`${t("jira.error.assigneeNotAssignable")} (${v})`);
        continue;
      }
      parts.push(`${k}: ${v}`);
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
    // baseUrl은 사용자가 자유 입력한다. Basic 헤더가 실려 나가므로 평문 http를 여기서 끊는다
    // — 폼 가드는 안내용이고, 저장된 설정으로 도는 요청은 이 관문만 지난다.
    const base = assertCredentialSafeBase(
      normalizeBaseUrl(auth.baseUrl),
      "jira.workspaceUrl",
    );
    return `${base}${path}`;
  }
  return `https://api.atlassian.com/ex/jira/${auth.cloudId}${path}`;
}

const TOKEN_REFRESH_THRESHOLD_MS = 60_000;

let refreshInFlight: Promise<JiraOAuthAuth> | null = null;

function refreshOnce(auth: JiraOAuthAuth): Promise<JiraOAuthAuth> {
  if (refreshInFlight) return refreshInFlight;
  // 락을 잡은 직후 저장분을 다시 본다 — 앞선 요청이 이미 회전을 끝냈다면 인자로 받은
  // refresh token은 소모된 값이라 invalid_grant가 난다(rotatedAuth 참조).
  refreshInFlight = (async () => {
    const stored = await readStoredAuth().catch(() => null);
    const rotated =
      stored?.kind === "oauth" ? pickRotatedAuth(auth, stored) : null;
    if (rotated) return rotated;
    const refreshed = await refreshOAuthToken(auth);
    await persistOAuthTokens(refreshed);
    return refreshed;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function ensureFreshAuth(auth: JiraAuth): Promise<JiraAuth> {
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
      throw new OAuthError(t("oauth.error.refreshExhausted"), {
        platform: "jira",
      });
    }
  }
  return res;
}

export async function jiraFetch<T = unknown>(
  auth: JiraAuth,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await authedFetch(auth, path, init, false);
  if (!res.ok) {
    throw new JiraError(res.status, messageForJiraStatus(res.status), await readErrorBody(res));
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
    throw new JiraError(res.status, messageForJiraStatus(res.status), await readErrorBody(res));
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

export function messageForJiraStatus(status: number): string {
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

export async function getUsersByAccountIds(
  auth: JiraAuth,
  accountIds: string[],
): Promise<JiraUser[]> {
  const ids = accountIds.slice(0, 200);
  if (ids.length === 0) return [];
  const params = new URLSearchParams();
  for (const id of ids) params.append("accountId", id);
  params.set("maxResults", String(ids.length));
  const page = await jiraFetch<{ values?: JiraUser[] }>(
    auth,
    `/rest/api/3/user/bulk?${params.toString()}`,
  );
  return page.values ?? [];
}

interface JiraSearchResponse {
  issues: JiraIssueSummary[];
  total: number;
}

// Sprint는 사이트마다 id가 다른 커스텀 필드라 클라이언트가 미리 알 수 있는 게 없다 —
// 이 스키마 문자열이 유일한 식별자다.
const SPRINT_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint";
// 보드가 많은 프로젝트에서 SW 메모리·동시 fetch가 폭증하지 않게 자른다(messages.ts MAX_SHEETS 선례).
const MAX_SPRINT_BOARDS = 5;

interface CreateMetaFieldsResponse {
  // 봉투 키는 `fields`다(2026-08-13 실측). 이슈타입 목록 엔드포인트의 `issueTypes`와도,
  // 페이지네이션 관용구 `values`와도 다르다.
  fields?: {
    fieldId: string;
    name?: string;
    schema?: { type?: string; custom?: string };
  }[];
  total?: number;
}

export function pickSprintField(
  res: CreateMetaFieldsResponse,
): JiraSprintFieldMeta | null {
  // 후보가 둘 이상인 사이트가 있다(마이그레이션 잔재). 어느 쪽이 맞는지 판정할 근거가
  // 클라이언트에 없으므로 우선순위 규칙을 발명하지 않고 첫 번째를 쓴다.
  const hit = (res.fields ?? []).find((f) => f.schema?.custom === SPRINT_SCHEMA);
  if (!hit) return null;
  return { fieldId: hit.fieldId, isArray: hit.schema?.type === "array" };
}

const SPRINT_STATE_ORDER = ["active", "future"];

function stateRank(state: string): number {
  const i = SPRINT_STATE_ORDER.indexOf(state);
  return i === -1 ? SPRINT_STATE_ORDER.length : i;
}

export function mergeBoardSprints(
  perBoard: { boardName: string; sprints: JiraSprint[] }[],
): { sprints: JiraSprint[]; multiBoard: boolean } {
  const byId = new Map<number, JiraSprint>();
  for (const board of perBoard) {
    for (const sprint of board.sprints) {
      // 같은 스프린트가 두 보드에 걸릴 수 있다 — 먼저 온 보드의 이름을 남긴다.
      if (byId.has(sprint.id)) continue;
      byId.set(sprint.id, { ...sprint, boardName: board.boardName });
    }
  }
  const sprints = [...byId.values()].sort((a, b) => {
    const order = stateRank(a.state) - stateRank(b.state);
    return order !== 0 ? order : a.id - b.id;
  });
  return { sprints, multiBoard: perBoard.length > 1 };
}

export async function getSprintFieldMeta(
  auth: JiraAuth,
  projectKey: string,
  issueTypeId: string,
): Promise<JiraSprintFieldMeta | null> {
  // 페이지네이션하지 않는다 — 실측 create 화면이 21필드였고 서버가 maxResults를 자체 캡 없이
  // 존중했다. 기본값(50)에 맡기면 필드가 많은 화면에서 sprint가 무음으로 잘린다.
  const res = await jiraFetch<CreateMetaFieldsResponse>(
    auth,
    `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}?maxResults=200`,
  );
  return pickSprintField(res);
}

interface AgileBoard {
  id: number;
  name: string;
  type?: string;
}

interface RawSprint {
  id: number;
  name: string;
  state: string;
  originBoardId?: number;
}

export async function listSprints(
  auth: JiraAuth,
  projectKey: string,
): Promise<{ sprints: JiraSprint[]; multiBoard: boolean }> {
  // 보드 목록 조회 실패는 재연동 전 OAuth 사용자(granular scope 없음) 경로다. 오류를 노출해도
  // 당장 할 수 있는 일이 없으므로 "고를 게 없다"로 수렴시킨다(design R6 — 사후 관측은 분석 축).
  const boards = await jiraFetch<{ values?: AgileBoard[] }>(
    auth,
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50`,
  )
    .then((res) => res.values ?? [])
    .catch(() => [] as AgileBoard[]);

  // team-managed 보드는 type "simple"로 오고 그중 일부가 스프린트를 정상 반환한다 —
  // 서버에서 type=scrum으로 좁히면 그 팀들이 통째로 무음 누락된다. 칸반만 뺀다(400 확정).
  const targets = boards
    .filter((b) => b.type !== "kanban")
    .slice(0, MAX_SPRINT_BOARDS);

  const results = await Promise.allSettled(
    targets.map((board) =>
      jiraFetch<{ values?: RawSprint[] }>(
        auth,
        `/rest/agile/1.0/board/${board.id}/sprint?state=active,future&maxResults=50`,
      ).then((res) => ({
        boardName: board.name,
        sprints: (res.values ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          state: s.state,
          boardId: s.originBoardId ?? board.id,
        })),
      })),
    ),
  );

  return mergeBoardSprints(
    results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
  );
}

export async function getSprint(
  auth: JiraAuth,
  sprintId: number,
): Promise<JiraSprint | null> {
  const raw = await jiraFetch<RawSprint>(
    auth,
    `/rest/agile/1.0/sprint/${sprintId}`,
  ).catch((err: unknown) => {
    // "없어졌다"로 읽어도 되는 건 404/403뿐이다. 429·5xx까지 null로 뭉개면 일시 실패가
    // sticky 검증에서 "스프린트가 사라졌다"가 돼 사용자가 고른 값을 지운다 — 그쪽은 던져서
    // 호출부가 검증을 건너뛰게 한다.
    if (err instanceof JiraError && (err.status === 404 || err.status === 403)) {
      return null;
    }
    throw err;
  });
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name,
    state: raw.state,
    boardId: raw.originBoardId ?? 0,
  };
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
  if (payload.sprintId != null) {
    // .catch가 없으면 createmeta의 429/5xx가 create 요청 자체를 막아 스프린트를 고른 제출만
    // 통째로 죽는다 — 스프린트가 빠진 채 생성되는 쪽이 낫다(design R7).
    const meta = await getSprintFieldMeta(
      auth,
      payload.projectKey,
      payload.issueTypeId,
    ).catch(() => null);
    if (meta) {
      fields[meta.fieldId] = meta.isArray ? [payload.sprintId] : payload.sprintId;
    }
  }
  return jiraFetch<JiraCreateIssueResult>(auth, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

export function extractMediaId(redirectUrl: string): string | undefined {
  const match =
    /\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//.exec(
      redirectUrl,
    );
  return match?.[1];
}

async function probeMediaRedirect(
  url: string,
  headers: Record<string, string>,
  method: "GET" | "HEAD",
): Promise<Response | undefined> {
  try {
    return await fetch(url, { method, headers });
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// attempt가 undefined를 반환하면 지연 후 재시도. 총 시도 = delaysMs.length + 1.
export async function retryResolve<T>(
  attempt: () => Promise<T | undefined>,
  delaysMs: number[],
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<T | undefined> {
  let result = await attempt();
  for (const ms of delaysMs) {
    if (result !== undefined) return result;
    await sleepFn(ms);
    result = await attempt();
  }
  return result;
}

// 변환 지연을 흡수하려고 백오프 재시도(총 5회 시도, 누적 5.3초).
const MEDIA_ID_RETRY_DELAYS_MS = [400, 900, 1500, 2500];

export async function getMediaFileId(
  auth: JiraAuth,
  attachmentId: string,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<string | undefined> {
  // probe는 본문이 아니라 리다이렉트된 res.url을 봐야 해서 authedFetch를 못 쓴다.
  // 그래서 토큰 신선화·401 갱신을 여기서 직접 한다 — 빠뜨리면 만료 토큰으로 401을 받고도
  // "리다이렉트 없음"과 구분되지 않아 조용히 mediaId를 잃고 영상이 본문에서 누락된다.
  let current = await ensureFreshAuth(auth);
  let refreshed = false;
  const path = `/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`;

  const probe = async (
    method: "GET" | "HEAD",
    extra: Record<string, string> = {},
  ): Promise<string | undefined> => {
    const send = () =>
      probeMediaRedirect(
        resolveUrl(current, path),
        { Authorization: authHeader(current), ...extra },
        method,
      );
    let res = await send();
    // 갱신하고도 401이면 토큰 문제가 아니다 — authedFetch와 같이 1회로 끊는다(재시도 루프에 refresh가 곱해지지 않게).
    if (res?.status === 401 && current.kind === "oauth" && !refreshed) {
      refreshed = true;
      current = await refreshOnce(current);
      res = await send();
    }
    return res ? extractMediaId(res.url) : undefined;
  };

  // 대용량 첨부(영상)는 업로드 직후 media 변환 전이라 redirect probe가 빈 값을 줄 수 있다.
  return retryResolve(
    async () => (await probe("GET", { Range: "bytes=0-0" })) ?? probe("HEAD"),
    MEDIA_ID_RETRY_DELAYS_MS,
    sleepFn,
  );
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
): Promise<JiraIssueStatus> {
  const res = await jiraFetch<{
    fields: {
      status: { name: string; statusCategory: { key: string } };
      issuetype: { name: string };
      summary: string;
    };
  }>(auth, `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status,issuetype,summary`);
  return {
    name: res.fields.status.name,
    categoryKey: res.fields.status.statusCategory.key,
    issueTypeName: res.fields.issuetype.name,
    summary: res.fields.summary,
  };
}

interface RawTransition {
  id: string;
  name: string;
  to: {
    name: string;
    statusCategory: { key: string };
  };
}

export function parseTransitions(
  raw: RawTransition[],
): JiraTransition[] {
  return raw.map((t) => ({
    id: t.id,
    name: t.name,
    to: { name: t.to.name, categoryKey: t.to.statusCategory.key },
  }));
}

export async function getTransitions(
  auth: JiraAuth,
  issueKey: string,
): Promise<JiraTransition[]> {
  const res = await jiraFetch<{ transitions: RawTransition[] }>(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  return parseTransitions(res.transitions);
}

export async function transitionIssue(
  auth: JiraAuth,
  issueKey: string,
  transitionId: string,
): Promise<void> {
  await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    },
  );
}

export async function searchEpics(
  auth: JiraAuth,
  projectKey: string,
  query?: string,
  hierarchyLevels?: number[],
): Promise<JiraIssueSummary[]> {
  const jqlEsc = (s: string) =>
    s.replace(/'/g, "''").replace(/([\\+\-!(){}[\]^"~*?])/g, "\\$1");
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
