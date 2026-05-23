import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CircleCheck, Inbox, Loader2, Search, SearchX, X } from "lucide-react";
import { useT } from "@/i18n";
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIssuesStore } from "@/store/issues-store";
import type { NormalizedSubmitResult } from "@/types/platform";
import { PageFooter, PageScroll, PageShell, Section } from "@/sidepanel/components/Section";
import { DraftDetailDialog } from "./DraftDetailDialog";
import { IssueRow } from "./IssueRow";
import {
  groupByDate,
  isRefreshable,
  issueTimestamp,
  matchesQuery,
  matchesStatus,
  type StatusFilter,
} from "./issueListUtils";

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
        (i) => i.status === "submitted" || !!i.selectionSnapshot || i.captureMode === "screenshot" || i.captureMode === "video" || i.captureMode === "freeform",
      ),
    [issues],
  );

  const filtered = useMemo(
    () =>
      displayable
        .filter((i) => matchesStatus(i, statusFilter))
        .filter((i) => !query || matchesQuery(i, query))
        .sort((a, b) => issueTimestamp(b) - issueTimestamp(a)),
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
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
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
      {displayable.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-[18px] font-semibold">{t("issueList.empty")}</h3>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
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
          <Section key={date} title={<>{date}<Badge variant="secondary" className="ml-2 align-middle text-xs tabular-nums">{group.length}</Badge></>} collapsible>
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
      {displayable.length > 0 && (
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
      )}
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
