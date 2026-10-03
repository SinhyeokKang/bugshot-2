import type { TranslationFn } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import type { AttachmentRetryReason, SubmissionRecoveryMeta } from "@/types/attachment";
import { recoveryFileState } from "./attachmentRecovery";
import { attachmentRecoveryReason, attachmentRetryBlocker, type RetryAttachmentsOutcome } from "./retryAttachments";

export const RETRY_REASON_KEY: Record<AttachmentRetryReason, TranslationKey> = {
  "account-changed": "recovery.retry.reason.account-changed",
  "account-unverified": "recovery.retry.reason.account-unverified",
  "remote-missing": "recovery.retry.reason.remote-missing",
  permission: "recovery.retry.reason.permission",
  authentication: "recovery.retry.reason.authentication",
  "body-conflict": "recovery.retry.reason.body-conflict",
  ambiguous: "recovery.retry.reason.ambiguous",
  "webhook-unsupported": "recovery.retry.reason.webhook-unsupported",
  legacy: "recovery.retry.reason.legacy",
  "local-missing": "recovery.retry.reason.local-missing",
};

// Run-level stops are never persisted (no journal field): the UI holds them for the session and a
// later press re-detects the same stop with zero writes.
const SESSION_STOPS: readonly AttachmentRetryReason[] = ["account-changed", "remote-missing", "permission", "authentication"];

export interface RetryUiState {
  canRetry: boolean;
  // Why retry is unavailable or needs a manual look; null when there is nothing to add.
  reason: AttachmentRetryReason | null;
  showOpenIssue: boolean;
}

// A stop is remembered with the account object it happened under: connecting the platform again
// replaces that object, which ends the stop without any subscription.
export interface RetryStop { reason: AttachmentRetryReason; attemptId: string; account: unknown }

export function retryUiState(meta: SubmissionRecoveryMeta | null, stop: RetryStop | null = null, account: unknown = undefined): RetryUiState {
  if (!meta) return { canRetry: false, reason: null, showOpenIssue: false };
  const stopReason = stop?.attemptId === meta.attemptId && stop.account === account ? stop.reason : null;
  const registered = meta.phase === "partial" && !!meta.destination;
  const reason = registered ? stopReason ?? attachmentRecoveryReason(meta) : null;
  return {
    canRetry: !stopReason && attachmentRetryBlocker(meta) === null,
    reason,
    // A 404 means the link leads nowhere; everything else keeps the way to the issue.
    showOpenIssue: !!meta.destination?.url && reason !== "remote-missing",
  };
}

export function pendingFileCount(meta: SubmissionRecoveryMeta | null): number {
  return meta?.files.filter((file) => recoveryFileState(meta.results.find((r) => r.fileId === file.id)) !== "complete").length ?? 0;
}

export function sessionStopReason(outcome: RetryAttachmentsOutcome): AttachmentRetryReason | null {
  return outcome.status === "blocked" && outcome.reason && SESSION_STOPS.includes(outcome.reason) ? outcome.reason : null;
}

export type RetrySummary =
  | { kind: "complete"; n: number }
  | { kind: "partial"; n: number }
  | { kind: "needsCheck" }
  | { kind: "storageFailed" }
  | { kind: "blocked"; reason: AttachmentRetryReason };

export function retrySummary(outcome: RetryAttachmentsOutcome, pending: number): RetrySummary | null {
  if (outcome.status === "busy") return null;
  if (outcome.storageFailed) return { kind: "storageFailed" };
  if (outcome.status === "complete") return { kind: "complete", n: pending || outcome.attachments.length };
  // A write whose result is unknown is shown as a static note, never as a count of failures.
  if (outcome.reason === "ambiguous") return { kind: "needsCheck" };
  if (outcome.status === "blocked" && outcome.reason) return { kind: "blocked", reason: outcome.reason };
  return { kind: "partial", n: outcome.remaining };
}

export function retrySummaryText(summary: RetrySummary, t: TranslationFn): string {
  switch (summary.kind) {
    case "complete": return t("recovery.retry.summary.complete", { n: summary.n });
    case "partial": return t("recovery.retry.summary.partial", { n: summary.n });
    case "needsCheck": return t("recovery.retry.summary.needsCheck");
    case "storageFailed": return t("recovery.retry.summary.storageFailed");
    case "blocked": return t(RETRY_REASON_KEY[summary.reason]);
  }
}
