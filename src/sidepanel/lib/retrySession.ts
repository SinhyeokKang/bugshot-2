import { toast } from "sonner";
import { create } from "zustand";
import { t } from "@/i18n";
import { useSettingsStore } from "@/store/settings-store";
import type { SubmissionRecoveryMeta } from "@/types/attachment";
import { retryAttachments, type RetryProgressEvent } from "./retryAttachments";
import { pendingFileCount, retrySummary, retrySummaryText, sessionStopReason, type RetryStop, type RetrySummary } from "./retryUi";

export interface RetrySession {
  running: boolean;
  // Per-file progress of the run in flight; shown in the detail panel only.
  progress: Record<string, { stage: RetryProgressEvent["stage"]; state: RetryProgressEvent["state"] }>;
  // One-line result for the detail's live region; set only while that detail is open.
  summary: RetrySummary | null;
  // A run-level stop (404/403/401/account) hides retry for this panel session, attempt and account only.
  stop: RetryStop | null;
  // Bumped when a run ends so mounted rows and panels re-read the journal.
  finishedAt: number;
}

interface RetrySessionsState {
  sessions: Record<string, RetrySession>;
  // Number of mounted detail panels per issue.
  details: Record<string, number>;
}

export const EMPTY_RETRY_SESSION: RetrySession = { running: false, progress: {}, summary: null, stop: null, finishedAt: 0 };

export const useRetrySessions = create<RetrySessionsState>(() => ({ sessions: {}, details: {} }));

// The connected account object of a platform; a reconnect swaps it, which lifts that platform's stops.
export const useRetryAccount = (platform: string): unknown => useSettingsStore((s) => (s.accounts as Record<string, unknown>)[platform]);

export const useRetrySession = (issueId: string): RetrySession => useRetrySessions((s) => s.sessions[issueId] ?? EMPTY_RETRY_SESSION);

export function resetRetrySessions(): void {
  useRetrySessions.setState({ sessions: {}, details: {} });
}

function patch(issueId: string, change: Partial<RetrySession>): void {
  useRetrySessions.setState((s) => ({ sessions: { ...s.sessions, [issueId]: { ...(s.sessions[issueId] ?? EMPTY_RETRY_SESSION), ...change } } }));
}

export function registerRetryDetail(issueId: string): () => void {
  useRetrySessions.setState((s) => ({ details: { ...s.details, [issueId]: (s.details[issueId] ?? 0) + 1 } }));
  return () => useRetrySessions.setState((s) => {
    const open = Math.max(0, (s.details[issueId] ?? 1) - 1);
    const session = s.sessions[issueId];
    // A summary belongs to the detail that was open when the run ended; reopening starts clean.
    const sessions = !open && session?.summary ? { ...s.sessions, [issueId]: { ...session, summary: null } } : s.sessions;
    return { details: { ...s.details, [issueId]: open }, sessions };
  });
}

// The single entry for retry actions: rows and the detail footer both call this, so a second press
// while one run is in flight never reaches the runner.
export async function startAttachmentRetry(issueId: string, meta: SubmissionRecoveryMeta, account: unknown): Promise<void> {
  if (useRetrySessions.getState().sessions[issueId]?.running) return;
  patch(issueId, { running: true, progress: {}, summary: null });
  let summary: RetrySummary | null = null;
  const pending = pendingFileCount(meta);
  let stop: RetryStop | null = null;
  try {
    const outcome = await retryAttachments(issueId, {
      onProgress: (event) => patch(issueId, { progress: { ...useRetrySessions.getState().sessions[issueId]?.progress, [event.fileId]: { stage: event.stage, state: event.state } } }),
    });
    summary = retrySummary(outcome, pending);
    const reason = sessionStopReason(outcome);
    stop = reason ? { reason, attemptId: meta.attemptId, account } : null;
  } catch {
    toast.error(t("bg.error.unknown"));
  }
  // A finished record leaves recovery and its detail disappears, so completion is always toasted.
  const announceInDetail = !!summary && summary.kind !== "complete" && (useRetrySessions.getState().details[issueId] ?? 0) > 0;
  patch(issueId, { running: false, progress: {}, stop, summary: announceInDetail ? summary : null, finishedAt: useRetrySessions.getState().sessions[issueId].finishedAt + 1 });
  if (summary && !announceInDetail) {
    const message = retrySummaryText(summary, t);
    if (summary.kind === "complete") toast.success(message);
    else toast.warning(message);
  }
}
