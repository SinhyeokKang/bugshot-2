import { dateBcp47, type TranslationFn } from "@/i18n";
import { extractNotionPageId } from "@/lib/notion-page-id";
import type { IssueRecord } from "@/store/issues-store";
import { connectedPlatforms } from "@/store/settings-store";
import type { Accounts, PlatformId } from "@/types/platform";

export type StatusFilter = "all" | "submitted" | "draft";

export function isRefreshable(issue: IssueRecord): boolean {
  if (issue.status !== "submitted" || !issue.url || !issue.key) return false;
  if (issue.platform === "jira") return true;
  if (issue.platform === "github") {
    return !!resolveGithubCoords(issue);
  }
  if (issue.platform === "linear") return true;
  if (issue.platform === "notion") {
    return !!resolveNotionPageId(issue);
  }
  if (issue.platform === "gitlab") {
    return !!resolveGitlabCoords(issue);
  }
  if (issue.platform === "asana") {
    return !!resolveAsanaCoords(issue);
  }
  if (issue.platform === "clickup") {
    return !!resolveClickupCoords(issue);
  }
  return false;
}

// Asana refresh는 task gid가 필요. 등록 시 저장된 asanaTaskGid가 없으면 refresh 불가.
export function resolveAsanaCoords(
  issue: Pick<IssueRecord, "asanaTaskGid">,
): { taskGid: string } | null {
  return issue.asanaTaskGid ? { taskGid: issue.asanaTaskGid } : null;
}

// ClickUp refresh는 task id가 필요. 등록 시 저장된 clickupTaskId가 없으면 refresh 불가.
export function resolveClickupCoords(
  issue: Pick<IssueRecord, "clickupTaskId">,
): { taskId: string } | null {
  return issue.clickupTaskId ? { taskId: issue.clickupTaskId } : null;
}

// GitLab refresh는 project id(글로벌)와 iid가 모두 필요. URL에서 project id를 복원할 수 없으므로
// 등록 시 저장된 gitlabProjectId가 없으면 refresh 불가.
export function resolveGitlabCoords(
  issue: Pick<IssueRecord, "gitlabProjectId" | "gitlabIssueIid" | "key">,
): { projectId: number; iid: number } | null {
  const projectId = issue.gitlabProjectId ?? null;
  const iid = issue.gitlabIssueIid ?? parseGithubIssueNumber(issue.key) ?? null;
  if (projectId == null || iid == null) return null;
  return { projectId, iid };
}

export function resolveNotionPageId(
  issue: Pick<IssueRecord, "notionPageId" | "url">,
): string | null {
  if (issue.notionPageId) return issue.notionPageId;
  return extractNotionPageId(issue.url);
}

export function parseGithubIssueNumber(key: string | undefined): number | null {
  if (!key) return null;
  const m = key.match(/^#?(\d+)$/);
  return m ? Number(m[1]) : null;
}

// `https://github.com/{owner}/{repo}/issues/{number}` 형태에서 좌표 추출. 다른 패턴이면 null.
export function parseGithubIssueUrl(
  url: string | undefined,
): { owner: string; repo: string; number: number } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2], number: Number(m[3]) };
  } catch {
    return null;
  }
}

// IssueRecord에 githubOwner/githubRepo가 없는 구 entry는 url에서 fallback 파싱.
export function resolveGithubCoords(
  issue: Pick<IssueRecord, "githubOwner" | "githubRepo" | "key" | "url">,
): { owner: string; repo: string; number: number } | null {
  const fromUrl = parseGithubIssueUrl(issue.url);
  const number = parseGithubIssueNumber(issue.key) ?? fromUrl?.number ?? null;
  const owner = issue.githubOwner ?? fromUrl?.owner ?? null;
  const repo = issue.githubRepo ?? fromUrl?.repo ?? null;
  if (!owner || !repo || number == null) return null;
  return { owner, repo, number };
}

export function matchesQuery(issue: IssueRecord, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    issue.title.toLowerCase().includes(lower) ||
    issue.pageUrl.toLowerCase().includes(lower) ||
    (issue.key?.toLowerCase().includes(lower) ?? false)
  );
}

export function matchesStatus(issue: IssueRecord, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return issue.status === filter;
}

// Slack 공유로 원본 데이터를 보존 중인 submitted 이슈 (승격 대상).
export function isSlackPreserved(issue: IssueRecord): boolean {
  return issue.status === "submitted" && !!issue.slackPreserved;
}

// 초안 필드(제목·섹션) 편집 허용 조건. 미제출 draft + Slack 보존 이슈(승격 전 문구 다듬기).
// Slack 보존 편집은 로컬 draft만 갱신 — 이미 발송된 Slack 메시지는 불변, 트래커 승격에만 반영.
export function canEditDraftFields(issue: IssueRecord): boolean {
  return issue.status === "draft" || isSlackPreserved(issue);
}

// 승격 가능한 트래커(= Slack 제외 연결 플랫폼).
export function promotableTargets(accounts: Accounts): PlatformId[] {
  return connectedPlatforms(accounts).filter((p) => p !== "slack");
}

// Slack 보존 이슈 + 승격 대상 트래커 1개 이상 → [자세히]·[승격] 노출 조건.
export function canPromoteSlack(issue: IssueRecord, accounts: Accounts): boolean {
  return isSlackPreserved(issue) && promotableTargets(accounts).length > 0;
}

// 제출 다이얼로그 available 탭. Slack 보존 이슈는 Slack 탭 제외.
export function submittablePlatforms(
  issue: IssueRecord,
  accounts: Accounts,
): PlatformId[] {
  return isSlackPreserved(issue)
    ? promotableTargets(accounts)
    : connectedPlatforms(accounts);
}

// pickInitialPlatform 결과를 available로 보정 — Slack/미연결이 초기 탭으로 잡혀 깨지는 것 방어.
export function resolveInitialPlatform(
  picked: PlatformId | null,
  available: PlatformId[],
): PlatformId {
  return picked && available.includes(picked) ? picked : (available[0] ?? "jira");
}

// Jira는 `[BUG-1]`, GitHub은 `#42`로 시각적 구분.
// (GitHub key는 이미 `#`이 포함된 형태로 저장됨 — submitToGithub.ts)
export function formatIssueKey(issue: Pick<IssueRecord, "platform" | "key">): string {
  if (!issue.key) return "";
  return issue.key;
}

export function issueTimestamp(issue: IssueRecord): number {
  return issue.submittedAt ?? issue.createdAt;
}

export function dateLabel(ts: number): string {
  const locale = dateBcp47();
  return new Date(ts).toLocaleDateString(locale, {
    year: "numeric",
    month: locale === "ko-KR" ? "long" : "short",
    day: "numeric",
  });
}

export function formatDate(ts: number, t: TranslationFn): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return t("time.justNow");
  if (diff < 3_600_000) return t("time.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("time.hoursAgo", { n: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t("time.daysAgo", { n: Math.floor(diff / 86_400_000) });
  return dateLabel(ts);
}

export function groupByDate(issues: IssueRecord[]): [string, IssueRecord[]][] {
  const groups = new Map<string, IssueRecord[]>();
  for (const issue of issues) {
    const key = dateLabel(issueTimestamp(issue));
    const list = groups.get(key);
    if (list) list.push(issue);
    else groups.set(key, [issue]);
  }
  return Array.from(groups);
}
