import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CircleCheck, Inbox, Loader2, Search, SearchX, Trash2, X } from "lucide-react";
import { SiGithub, SiJirasoftware, SiLinear } from "@icons-pack/react-simple-icons";
import { useT, dateBcp47 } from "@/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore, jiraSiteId } from "@/store/settings-store";
import type { JiraIssueStatus } from "@/types/jira";
import type { GithubIssueStatus } from "@/types/github";
import type { LinearIssueStatus } from "@/types/linear";
import type { NormalizedSubmitResult, PlatformId } from "@/types/platform";
import { sendBg } from "@/types/messages";
import { PageFooter, PageScroll, PageShell, Section } from "../components/Section";
import { DraftDetailDialog } from "./DraftDetailDialog";

type StatusFilter = "all" | "submitted" | "draft";

export function isRefreshable(issue: IssueRecord): boolean {
  if (issue.status !== "submitted" || !issue.url || !issue.key) return false;
  if (issue.platform === "jira") return true;
  if (issue.platform === "github") {
    return !!resolveGithubCoords(issue);
  }
  if (issue.platform === "linear") return true;
  return false;
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

export function IssueListTab() {
  const t = useT();
  const issues = useIssuesStore((s) => s.issues);
  const clearIssues = useIssuesStore((s) => s.clearIssues);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pendingRef = useRef(0);
  const [successResult, setSuccessResult] = useState<NormalizedSubmitResult | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const displayable = useMemo(
    () =>
      issues.filter(
        (i) => i.status === "submitted" || !!i.selectionSnapshot || i.captureMode === "screenshot" || i.captureMode === "video",
      ),
    [issues],
  );

  const filtered = useMemo(
    () =>
      displayable
        .filter((i) => matchesStatus(i, statusFilter))
        .filter((i) => !query || matchesQuery(i, query))
        .sort((a, b) => b.createdAt - a.createdAt),
    [displayable, statusFilter, query],
  );

  // refresh가 의미있는 entry: 플랫폼 인증이 필요한 status 조회를 호출할 수 있는 것만.
  // jira: jira 연결 + key + url
  // github: github 연결 + owner/repo + key + url
  const refreshableCount = useMemo(
    () =>
      displayable.filter((i) => isRefreshable(i)).length,
    [displayable],
  );

  const resetFilters = useCallback(() => {
    setQuery("");
    setStatusFilter("all");
  }, []);

  const handleRefresh = useCallback(() => {
    if (refreshableCount === 0) {
      setRefreshKey((k) => k + 1);
      return;
    }
    pendingRef.current = refreshableCount;
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
  }, [refreshableCount]);

  const handleBadgeLoaded = useCallback(() => {
    pendingRef.current -= 1;
    if (pendingRef.current <= 0) setIsRefreshing(false);
  }, []);

  const activeDraft = useMemo(
    () => (draftId ? issues.find((i) => i.id === draftId) ?? null : null),
    [issues, draftId],
  );

  if (successResult) {
    return (
      <PageShell>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <CircleCheck className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="text-[18px] font-semibold">{t("jira.submitted")}</h3>
          <a
            href={successResult.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {successResult.key}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <div className="mt-6">
            <Button variant="outline" onClick={() => setSuccessResult(null)}>
              {t("common.ok")}
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  if (displayable.length === 0) {
    return (
      <PageShell>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-[18px] font-semibold">{t("issueList.empty")}</h3>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="shrink-0 border-b border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <TabsList className="h-9">
              <TabsTrigger value="all">{t("issueList.filter.all")}</TabsTrigger>
              <TabsTrigger value="submitted">{t("issueList.filter.submitted")}</TabsTrigger>
              <TabsTrigger value="draft">{t("issueList.filter.draft")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative ml-auto w-full max-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("issueList.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`h-9 pl-8 text-sm ${query ? "pr-8" : ""}`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <SearchX className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-[18px] font-semibold">{t("issueList.noResults")}</h3>
          <Button variant="outline" className="mt-6" onClick={resetFilters}>
            {t("issueList.resetFilter")}
          </Button>
        </div>
      ) : (
        <PageScroll>
          {groupByDate(filtered).map(([date, group]) => (
          <Section key={date} title={date} collapsible>
            <ul className="flex flex-col gap-2">
              {group.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  refreshKey={refreshKey}
                  onOpenDraft={() => setDraftId(issue.id)}
                  onBadgeLoaded={handleBadgeLoaded}
                />
              ))}
            </ul>
          </Section>
        ))}
        </PageScroll>
      )}
      <PageFooter>
        <div className="flex justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive">
                {t("issueList.deleteAll")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("issueList.deleteAll.title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("issueList.deleteAll.body")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                <AlertDialogAction onClick={clearIssues}>
                  {t("issueList.deleteAll")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="outline"
            disabled={isRefreshing || refreshableCount === 0}
            onClick={handleRefresh}
            className="relative"
          >
            {isRefreshing && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={isRefreshing ? "opacity-0" : undefined}>
              {t("issueList.refresh")}
            </span>
          </Button>
        </div>
      </PageFooter>
      <DraftDetailDialog
        issue={activeDraft}
        open={!!activeDraft}
        onOpenChange={(v) => !v && setDraftId(null)}
        onSubmitSuccess={(result) => {
          setDraftId(null);
          setSuccessResult(result);
        }}
      />
    </PageShell>
  );
}

function IssueRow({
  issue,
  refreshKey,
  onOpenDraft,
  onBadgeLoaded,
}: {
  issue: IssueRecord;
  refreshKey: number;
  onOpenDraft: () => void;
  onBadgeLoaded: () => void;
}) {
  const t = useT();
  const isSubmitted = issue.status === "submitted" && !!issue.url;
  const removeIssue = useIssuesStore((s) => s.removeIssue);

  // submitted: [플랫폼 chip] + 작성일 + 위치(jira host / github owner-repo) + key + (jira 한정) issueTypeName
  // draft: 초안 + 작성일 (플랫폼 미정)
  const textMetaParts: string[] = [];
  if (isSubmitted) {
    textMetaParts.push(formatDate(issue.createdAt, t));
    if (issue.platform === "github") {
      const coords = resolveGithubCoords(issue);
      if (coords) textMetaParts.push(`${coords.owner}/${coords.repo}`);
    } else if (issue.platform === "jira" && issue.url) {
      try { textMetaParts.push(new URL(issue.url).hostname); } catch {}
    } else if (issue.platform === "linear" && issue.linearTeamKey) {
      textMetaParts.push(issue.linearTeamKey);
    }
    if (issue.key) textMetaParts.push(formatIssueKey(issue));
    if (issue.platform === "jira" && issue.issueTypeName) {
      textMetaParts.push(issue.issueTypeName);
    } else if (issue.platform === "github" && issue.githubLabels?.length) {
      textMetaParts.push(issue.githubLabels.join(", "));
    } else if (issue.platform === "linear" && issue.linearLabelName) {
      textMetaParts.push(issue.linearLabelName);
    }
  } else {
    textMetaParts.push(t("issueList.draft"));
    textMetaParts.push(formatDate(issue.createdAt, t));
  }

  const handleCardClick = () => {
    if (isSubmitted) {
      chrome.tabs.create({ url: issue.url!, active: true });
    } else {
      // Card는 비포커서블이라 직전 포커스(탭 trigger 등)가 그대로 남는다.
      // Radix Dialog가 root에 aria-hidden을 씌우면 포커스된 후손이 있어
      // 브라우저 a11y 경고가 뜨므로, 미리 blur해서 경고를 막는다.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      onOpenDraft();
    }
  };

  return (
    <li>
      <Card
        className="group cursor-pointer transition-colors hover:bg-muted/50"
        onClick={handleCardClick}
      >
        <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">
              {issue.title || t("common.untitled")}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              {isSubmitted ? (
                <>
                  <PlatformChip platform={issue.platform} />
                  {textMetaParts.length > 0 ? <span aria-hidden>·</span> : null}
                </>
              ) : null}
              <span className="min-w-0 truncate">{textMetaParts.join(" · ")}</span>
            </span>
          </div>
          {isSubmitted && issue.key ? (
            <SubmittedBadge
              issueId={issue.id}
              issueKey={issue.key}
              issueSiteId={issue.jiraSiteId}
              issueUrl={issue.url}
              platform={issue.platform}
              githubOwner={issue.githubOwner}
              githubRepo={issue.githubRepo}
              linearIdentifier={issue.linearIdentifier}
              refreshKey={refreshKey}
              onLoaded={onBadgeLoaded}
            />
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("issueList.deleteDraft.title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("issueList.deleteDraft.body")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => removeIssue(issue.id)}
                  >
                    {t("issueList.deleteIssue")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

const STATUS_CATEGORY_COLORS: Record<
  string,
  { bg: string; text: string; darkBg: string; darkText: string }
> = {
  new: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    darkBg: "dark:bg-slate-500/15",
    darkText: "dark:text-slate-300",
  },
  indeterminate: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    darkBg: "dark:bg-blue-500/15",
    darkText: "dark:text-blue-300",
  },
  done: {
    bg: "bg-green-100",
    text: "text-green-700",
    darkBg: "dark:bg-green-500/15",
    darkText: "dark:text-green-300",
  },
};

const LINEAR_STATE_TYPE_COLORS: Record<string, typeof STATUS_CATEGORY_COLORS[string]> = {
  backlog: STATUS_CATEGORY_COLORS.new,
  unstarted: STATUS_CATEGORY_COLORS.new,
  started: STATUS_CATEGORY_COLORS.indeterminate,
  completed: STATUS_CATEGORY_COLORS.done,
  cancelled: STATUS_CATEGORY_COLORS.new,
};

const LINEAR_STATE_I18N: Record<string, string> = {
  backlog: "issueList.linear.backlog",
  unstarted: "issueList.linear.unstarted",
  started: "issueList.linear.started",
  completed: "issueList.linear.completed",
  cancelled: "issueList.linear.cancelled",
};


function PlatformChip({ platform }: { platform: PlatformId }) {
  const t = useT();
  if (platform === "jira") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiJirasoftware className="h-3 w-3" color="default" />
        {t("platform.tab.jira")}
      </span>
    );
  }
  if (platform === "linear") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <SiLinear className="h-3 w-3" color="default" />
        {t("platform.tab.linear")}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <SiGithub className="h-3 w-3 dark:invert" color="default" />
      {t("platform.tab.github")}
    </span>
  );
}

type GithubBadgeStatus =
  | { kind: "open" }
  | { kind: "closed"; reason: "completed" | "not_planned" | "reopened" | null };

function SubmittedBadge({
  issueId,
  issueKey,
  issueSiteId,
  issueUrl,
  platform,
  githubOwner,
  githubRepo,
  linearIdentifier,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  issueKey: string;
  issueSiteId?: string;
  issueUrl?: string;
  platform: PlatformId;
  githubOwner?: string;
  githubRepo?: string;
  linearIdentifier?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const ghAccount = useSettingsStore((s) => s.accounts.github);
  const linearAccount = useSettingsStore((s) => s.accounts.linear);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const currentSiteId = jiraAccount?.auth ? jiraSiteId(jiraAccount.auth) : null;
  const siteMatch = !issueSiteId || currentSiteId === issueSiteId;
  const [jiraStatus, setJiraStatus] = useState<JiraIssueStatus | "error" | null>(null);
  const [ghStatus, setGhStatus] = useState<GithubBadgeStatus | "error" | null>(null);
  const [linearStatus, setLinearStatus] = useState<LinearIssueStatus | "error" | null>(null);

  useEffect(() => {
    if (platform === "jira") {
      if (!jiraAccount?.auth || !siteMatch) { setJiraStatus("error"); onLoaded(); return; }
      sendBg<JiraIssueStatus>({ type: "jira.getIssueStatus", issueKey })
        .then((res) => {
          setJiraStatus(res);
          const patch: Record<string, string> = {};
          if (res.issueTypeName) patch.issueTypeName = res.issueTypeName;
          if (res.summary) patch.title = res.summary;
          if (Object.keys(patch).length) patchIssue(issueId, patch);
        })
        .catch(() => setJiraStatus("error"))
        .finally(onLoaded);
      return;
    }
    if (platform === "github") {
      const coords = resolveGithubCoords({
        githubOwner,
        githubRepo,
        key: issueKey,
        url: issueUrl,
      });
      if (!ghAccount || !coords) {
        setGhStatus("error"); onLoaded(); return;
      }
      sendBg<GithubIssueStatus>({
        type: "github.getIssueStatus",
        owner: coords.owner,
        repo: coords.repo,
        number: coords.number,
      })
        .then((res) => {
          setGhStatus(
            res.state === "open"
              ? { kind: "open" }
              : { kind: "closed", reason: res.stateReason ?? null },
          );
          const patch: Partial<IssueRecord> = {};
          if (res.title) patch.title = res.title;
          if (!githubOwner) patch.githubOwner = coords.owner;
          if (!githubRepo) patch.githubRepo = coords.repo;
          patch.githubLabels = res.labels.map((l) => l.name).filter(Boolean);
          if (Object.keys(patch).length) patchIssue(issueId, patch);
        })
        .catch(() => setGhStatus("error"))
        .finally(onLoaded);
      return;
    }
    if (platform === "linear") {
      const identifier = linearIdentifier ?? issueKey;
      if (!linearAccount?.auth || !identifier) {
        setLinearStatus("error"); onLoaded(); return;
      }
      sendBg<LinearIssueStatus>({ type: "linear.getIssueStatus", issueId: identifier })
        .then((res) => {
          setLinearStatus(res);
          const patch: Partial<IssueRecord> = {};
          if (res.title) patch.title = res.title;
          if (res.identifier) patch.linearIdentifier = res.identifier;
          if (res.labels.length > 0) patch.linearLabelName = res.labels[0].name;
          if (Object.keys(patch).length) patchIssue(issueId, patch);
        })
        .catch(() => setLinearStatus("error"))
        .finally(onLoaded);
      return;
    }
    onLoaded();
  }, [platform, jiraAccount?.auth, ghAccount, linearAccount?.auth, issueKey, issueUrl, githubOwner, githubRepo, linearIdentifier, refreshKey, siteMatch, onLoaded, issueId, patchIssue]);

  if (platform === "jira") {
    if (jiraStatus === "error") {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.unknown")}
        </Badge>
      );
    }
    const colors = jiraStatus
      ? STATUS_CATEGORY_COLORS[jiraStatus.categoryKey] ??
        STATUS_CATEGORY_COLORS.new
      : null;
    if (!jiraStatus || !colors) return null;
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
      >
        {jiraStatus.name}
      </Badge>
    );
  }

  if (platform === "github") {
    if (ghStatus === "error") {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.unknown")}
        </Badge>
      );
    }
    if (!ghStatus) {
      return (
        <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
          {t("issueList.submitted")}
        </Badge>
      );
    }
    const ghLabel =
      ghStatus.kind === "open"
        ? t("issueList.github.open")
        : ghStatus.reason === "not_planned"
          ? t("issueList.github.notPlanned")
          : t("issueList.github.closed");
    const ghColors =
      ghStatus.kind === "open"
        ? STATUS_CATEGORY_COLORS.indeterminate
        : ghStatus.reason === "not_planned"
          ? STATUS_CATEGORY_COLORS.new
          : STATUS_CATEGORY_COLORS.done;
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 border-transparent text-[11px] ${ghColors.bg} ${ghColors.text} ${ghColors.darkBg} ${ghColors.darkText}`}
      >
        {ghLabel}
      </Badge>
    );
  }

  // Linear
  if (linearStatus === "error") {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.unknown")}
      </Badge>
    );
  }
  if (!linearStatus) {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.submitted")}
      </Badge>
    );
  }
  const stateType = linearStatus.state.type;
  const linearColors = LINEAR_STATE_TYPE_COLORS[stateType] ?? STATUS_CATEGORY_COLORS.new;
  const i18nKey = LINEAR_STATE_I18N[stateType] as Parameters<typeof t>[0] | undefined;
  const linearLabel = i18nKey ? t(i18nKey) : linearStatus.state.name;
  return (
    <Badge
      variant="outline"
      className={`w-fit shrink-0 border-transparent text-[11px] ${linearColors.bg} ${linearColors.text} ${linearColors.darkBg} ${linearColors.darkText}`}
    >
      {linearLabel}
    </Badge>
  );
}

// Jira는 `[BUG-1]`, GitHub은 `#42`로 시각적 구분.
// (GitHub key는 이미 `#`이 포함된 형태로 저장됨 — submitToGithub.ts)
export function formatIssueKey(issue: Pick<IssueRecord, "platform" | "key">): string {
  if (!issue.key) return "";
  return issue.key;
}

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(dateBcp47(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDate(ts: number, t: (key: any, params?: any) => string): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return t("time.justNow");
  if (diff < 3_600_000) return t("time.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("time.hoursAgo", { n: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t("time.daysAgo", { n: Math.floor(diff / 86_400_000) });
  return dateLabel(ts);
}

function groupByDate(issues: IssueRecord[]): [string, IssueRecord[]][] {
  const groups = new Map<string, IssueRecord[]>();
  for (const issue of issues) {
    const key = dateLabel(issue.createdAt);
    const list = groups.get(key);
    if (list) list.push(issue);
    else groups.set(key, [issue]);
  }
  return Array.from(groups);
}
