import { retryFailureReason } from "@/lib/attachment-failure";
import { sendBg } from "@/lib/bg-client";
import type { AttachmentCheckpoint, AttachmentCheckpointPatch, AttachmentResult, AttachmentRetryReason, RetryPlatform, SubmissionRecoveryMeta } from "@/types/attachment";
import { blobToDataUrl, checkpointAttachmentRetry, checkpointSubmission, readRecoveryFile, readSubmissionRecovery } from "@/store/blob-db";
import { IssueAlreadySubmittedError, isIssueSubmitting, withIssueOperationLock } from "@/store/issues-store";
import { mergeCheckpoint, retrySnapshotBlocker } from "./attachmentCheckpoints";
import { RETRY_ADAPTERS, RetryStop, fileFinished, planFileStage, type RetryContext, type RetryFileState, type RetryStage } from "./retryAttachmentAdapters";
import { completeRecoveredSubmission, notifyRecoveryChange } from "./submissionRecovery";

export type { RetryFileState, RetryStage } from "./retryAttachmentAdapters";

export interface RetryProgressEvent {
  fileId: string;
  stage: RetryStage;
  state: RetryFileState;
}

export interface RetryAttachmentsOutcome {
  // complete: every file finished and the record left recovery. partial: some files remain.
  // blocked: stopped by `reason` (401/403/404/account) — nothing new was written after the stop.
  // busy: another panel or run holds the issue.
  status: "complete" | "partial" | "blocked" | "busy";
  reason?: AttachmentRetryReason;
  attachments: AttachmentResult[];
  remaining: number;
  // A local journal or list write failed; preserved files are kept.
  storageFailed?: boolean;
}

type RetryMeta = RetryContext["meta"];

export function planAttachmentRetry(meta: SubmissionRecoveryMeta): Array<{ fileId: string; stage: RetryStage }> {
  if (!meta.retry) return [];
  return meta.files.flatMap((file) => {
    const cp = meta.retry!.checkpoints.find((c) => c.fileId === file.id);
    const stage = cp ? planFileStage(meta.platform, file, cp, meta.retry!.bodyPlan.replacements.some((r) => r.fileId === file.id)) : null;
    return stage ? [{ fileId: file.id, stage }] : [];
  });
}

// Why the retry action should not be offered; null when a retry can make progress.
export function attachmentRetryBlocker(meta: SubmissionRecoveryMeta): AttachmentRetryReason | null {
  const blocker = retrySnapshotBlocker(meta);
  if (blocker || planAttachmentRetry(meta).length) return blocker;
  // Unfinished GitHub/GitLab files without a recorded body slot can only be downloaded.
  const slotless = (meta.platform === "github" || meta.platform === "gitlab") && meta.retry!.checkpoints.some((cp) =>
    cp.upload !== "done" && cp.body !== "not-applicable" && !meta.retry!.bodyPlan.replacements.some((r) => r.fileId === cp.fileId));
  return slotless ? "legacy" : "ambiguous";
}

// What the recovery UI says about a record from durable state alone. Body conflicts keep the retry
// action (blocker null); run-level stops (404/403/401/account) live only in the last outcome.
export function attachmentRecoveryReason(meta: SubmissionRecoveryMeta): AttachmentRetryReason | null {
  return attachmentRetryBlocker(meta) ?? (meta.retry?.checkpoints.some((cp) => cp.body === "conflict") ? "body-conflict" : null);
}

const running = new Set<string>();
export function isAttachmentRetryRunning(issueId: string): boolean {
  return running.has(issueId);
}

const remainingOf = (results: readonly AttachmentResult[]) => results.filter((r) => r.delivery !== "attached" || r.presentation === "failed" || r.failure).length;

export async function retryAttachments(
  issueId: string,
  options: { onProgress?: (event: RetryProgressEvent) => void } = {},
): Promise<RetryAttachmentsOutcome> {
  const busy: RetryAttachmentsOutcome = { status: "busy", attachments: [], remaining: 0 };
  if (isIssueSubmitting(issueId) || running.has(issueId)) return busy;
  try {
    // The same origin-wide lock as initial submission, reconcile and deletion; never a second one.
    return await withIssueOperationLock(issueId, async () => {
      running.add(issueId);
      try { return await run(issueId, options.onProgress); }
      finally { running.delete(issueId); }
    });
  } catch (error) {
    if (error instanceof IssueAlreadySubmittedError) return busy;
    throw error;
  }
}

class StorageFailure extends Error {}

const retryReady = (meta: SubmissionRecoveryMeta): meta is RetryMeta => !!meta.destination && !!meta.retry;

async function run(issueId: string, onProgress?: (event: RetryProgressEvent) => void): Promise<RetryAttachmentsOutcome> {
  // Re-read inside the lock: whatever the caller saw may be stale.
  const current = await readSubmissionRecovery(issueId).catch(() => undefined);
  if (current === undefined) return { status: "blocked", reason: "ambiguous", attachments: [], remaining: 0, storageFailed: true };
  if (!current) return { status: "blocked", reason: "ambiguous", attachments: [], remaining: 0 };
  const blocker = retrySnapshotBlocker(current);
  if (blocker || !retryReady(current)) return { status: "blocked", reason: blocker ?? "ambiguous", attachments: current.results, remaining: remainingOf(current.results) };
  const meta = current;
  const idle = attachmentRetryBlocker(meta);
  if (idle) return { status: "blocked", reason: idle, attachments: meta.results, remaining: remainingOf(meta.results) };

  const identityStop = await checkIdentity(meta);
  if (identityStop) return { status: "blocked", reason: identityStop, attachments: meta.results, remaining: remainingOf(meta.results) };

  const { attemptId } = meta;
  let revision = meta.retry.revision;
  const checkpoints = new Map(meta.retry.checkpoints.map((cp) => [cp.fileId, cp]));
  const failures = new Map<string, NonNullable<AttachmentResult["failure"]>>();
  const localMissing = new Set<string>();
  const touched = new Set<string>();
  const write = async (patches: AttachmentCheckpointPatch[], lastWritten?: string) => {
    const merged = patches.map((patch) => mergeCheckpoint(checkpoints.get(patch.fileId), patch));
    try {
      revision = await checkpointAttachmentRetry(issueId, attemptId, revision, { checkpoints: merged, ...(lastWritten !== undefined ? { lastWritten } : {}) });
    } catch { throw new StorageFailure("Retry checkpoint failed"); }
    for (const cp of merged) { checkpoints.set(cp.fileId, cp); touched.add(cp.fileId); }
  };
  const ctx: RetryContext = {
    meta,
    checkpoint: (fileId) => checkpoints.get(fileId)!,
    save: (...patches) => write(patches),
    saveBody: (lastWritten, ...patches) => write(patches, lastWritten),
    bytes: async (fileId) => {
      const blob = await readRecoveryFile(meta, fileId).catch(() => null);
      return blob ? blobToDataUrl(blob) : null;
    },
    missing: (fileId) => {
      localMissing.add(fileId);
      onProgress?.({ fileId, stage: "upload", state: "local-missing" });
    },
    failed: (fileId, failure) => { failures.set(fileId, failure); },
    emit: (fileId, stage, state) => onProgress?.({ fileId, stage, state }),
  };

  let stop: RetryStop["reason"] | undefined;
  let ambiguousError = false;
  try {
    await RETRY_ADAPTERS[meta.platform as RetryPlatform](ctx);
  } catch (error) {
    if (error instanceof StorageFailure) {
      const attachments = resultsOf(meta, checkpoints, failures, localMissing, touched);
      return { status: "partial", storageFailed: true, attachments, remaining: remainingOf(attachments) };
    }
    if (error instanceof RetryStop) stop = error.reason;
    else ambiguousError = true;
  }

  const results = resultsOf(meta, checkpoints, failures, localMissing, touched);
  const complete = !meta.submissionFailure && remainingOf(results) === 0;
  const outcome: RetryAttachmentsOutcome = {
    status: complete ? "complete" : stop ? "blocked" : "partial",
    attachments: results,
    remaining: remainingOf(results),
  };
  const reason = stop ?? reasonOf(meta, checkpoints, localMissing, ambiguousError);
  if (!complete && reason) outcome.reason = reason;
  // Checkpoints above are already durable; the per-file results follow them, never the reverse.
  try {
    await checkpointSubmission(issueId, attemptId, { phase: complete ? "complete" : "partial", results, destination: meta.destination, submissionFailure: meta.submissionFailure });
  } catch { return { ...outcome, storageFailed: true }; }
  try {
    if (complete) await completeRecoveredSubmission((await readSubmissionRecovery(issueId))!);
    else await notifyRecoveryChange(issueId, attemptId);
  } catch { return { ...outcome, storageFailed: true }; }
  return outcome;
}

async function checkIdentity(meta: RetryMeta): Promise<AttachmentRetryReason | null> {
  try {
    const result = await sendBg<{ identity?: unknown }>({ type: `${meta.platform as RetryPlatform}.getAccountIdentity`, destination: meta.destination });
    return result?.identity === meta.retry.accountIdentity ? null : "account-changed";
  } catch (error) {
    const reason = retryFailureReason(error);
    // Disconnected or unreadable connection: same outcome as a different account — reconnect first.
    return reason === "ambiguous" ? "account-changed" : reason;
  }
}

function resultsOf(meta: RetryMeta, checkpoints: Map<string, AttachmentCheckpoint>, failures: Map<string, NonNullable<AttachmentResult["failure"]>>, localMissing: Set<string>, touched: Set<string>): AttachmentResult[] {
  return meta.files.map((file): AttachmentResult => {
    const cp = checkpoints.get(file.id)!;
    const before = meta.results.find((r) => r.fileId === file.id);
    // A file this run never wrote keeps its last recorded outcome (e.g. Notion body-limit).
    if (before?.failure && !touched.has(file.id) && !localMissing.has(file.id) && !fileFinished(meta.platform, file, cp)) return before;
    const previous = before?.failure;
    const failure = (stage: "upload" | "link" | "body") => {
      const known = failures.get(file.id) ?? previous;
      return known?.stage === stage ? known : { stage, code: "unknown" as const };
    };
    if (localMissing.has(file.id)) return { fileId: file.id, delivery: "failed", presentation: "failed", failure: { stage: "source", code: "local-storage" } };
    if (fileFinished(meta.platform, file, cp)) return { fileId: file.id, delivery: "attached", presentation: cp.body === "not-applicable" ? "not-applicable" : "complete" };
    if (cp.upload !== "done") return { fileId: file.id, delivery: cp.upload === "unknown" ? "unknown" : "failed", presentation: "failed", failure: failure("upload") };
    if (cp.link !== "done" && cp.link !== "not-applicable") return { fileId: file.id, delivery: cp.link === "unknown" ? "unknown" : "failed", presentation: "failed", failure: failure("link") };
    return { fileId: file.id, delivery: "attached", presentation: "failed", failure: failure("body") };
  });
}

function reasonOf(meta: RetryMeta, checkpoints: Map<string, AttachmentCheckpoint>, localMissing: Set<string>, ambiguousError: boolean): AttachmentRetryReason | undefined {
  const all = [...checkpoints.values()];
  if (all.some((cp) => cp.body === "conflict")) return "body-conflict";
  if (localMissing.size) return "local-missing";
  if (ambiguousError || meta.submissionFailure) return "ambiguous";
  const open = meta.files.filter((f) => !fileFinished(meta.platform, f, checkpoints.get(f.id)!));
  // Left unknown after reconciling against the provider's attachment list: may already be there.
  const stuck = (f: RetryMeta["files"][number]) => planFileStage(meta.platform, f, checkpoints.get(f.id)!, meta.retry.bodyPlan.replacements.some((r) => r.fileId === f.id)) === null
    || (checkpoints.get(f.id)!.upload === "unknown" && (meta.platform === "jira" || meta.platform === "asana"));
  if (open.length && open.every(stuck)) return "ambiguous";
  return undefined;
}
