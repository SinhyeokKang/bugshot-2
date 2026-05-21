import { dateBcp47, type TranslationFn } from "@/i18n";
import { extractNotionPageId } from "@/lib/notion-page-id";
import type { IssueRecord } from "@/store/issues-store";

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
  return false;
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
