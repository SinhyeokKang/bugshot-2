import { describe, expect, it } from "vitest";
import { failedCheckpoint, failedResult, retryMeta } from "@/test/retry-meta";
import type { RetryAttachmentsOutcome } from "../retryAttachments";
import { RETRY_REASON_KEY, pendingFileCount, retrySummary, retryUiState, sessionStopReason } from "../retryUi";

const ACCOUNT = { token: "t1" };
const uploadedGithub = (fileId: string, patch = {}) => failedCheckpoint(fileId, { upload: "done", uploaded: { platform: "github", href: `https://x/${fileId}` }, ...patch });

describe("retryUiState — unavailable-state matrix", () => {
  it("offers retry on a plain partial record with nothing to say", () => {
    expect(retryUiState(retryMeta())).toEqual({ canRetry: true, reason: null, showOpenIssue: true });
  });

  it.each([
    ["account not verified at submission", retryMeta({ identity: null }), "account-unverified"],
    ["a phase-one record without a snapshot", retryMeta({ retry: undefined }), "legacy"],
    ["a body place that was never recorded", retryMeta({ slots: false }), "legacy"],
    ["a Webhook record", retryMeta({ platform: "webhook" }), "webhook-unsupported"],
    ["local files removed", retryMeta({ localFilesRemoved: true }), "local-missing"],
    ["an upload whose result is unknown", retryMeta({ checkpoints: [failedCheckpoint("capture:after-0", { upload: "unknown" })] }), "ambiguous"],
  ] as const)("hides retry for %s", (_name, meta, reason) => {
    const state = retryUiState(meta);
    expect(state.canRetry).toBe(false);
    expect(state.reason).toBe(reason);
  });

  it("keeps retry for a body conflict and names it", () => {
    const meta = retryMeta({ checkpoints: [uploadedGithub("capture:after-0", { body: "conflict" })] });
    expect(retryUiState(meta)).toEqual({ canRetry: true, reason: "body-conflict", showOpenIssue: true });
  });

  it("never enables retry from an empty file list or an unknown creation", () => {
    expect(retryUiState(retryMeta({ checkpoints: [], submissionFailure: { stage: "body", code: "network" } })).canRetry).toBe(false);
    const unknown = retryMeta({ phase: "unknown", destination: undefined });
    expect(retryUiState(unknown)).toMatchObject({ canRetry: false, reason: null });
  });

  it("does not offer retry on a complete-but-retained record", () => {
    expect(retryUiState(retryMeta({ phase: "complete" }))).toMatchObject({ canRetry: false, reason: null });
  });

  it("returns nothing before the journal is read", () => {
    expect(retryUiState(null)).toEqual({ canRetry: false, reason: null, showOpenIssue: false });
  });

  it.each(["account-changed", "remote-missing", "permission", "authentication"] as const)("a %s stop hides retry for the session without persisting", (stop) => {
    const state = retryUiState(retryMeta(), { reason: stop, attemptId: "a", account: ACCOUNT }, ACCOUNT);
    expect(state.canRetry).toBe(false);
    expect(state.reason).toBe(stop);
  });

  it("drops the issue link only when the remote issue is gone", () => {
    expect(retryUiState(retryMeta(), { reason: "remote-missing", attemptId: "a", account: ACCOUNT }, ACCOUNT).showOpenIssue).toBe(false);
    for (const stop of ["account-changed", "permission", "authentication"] as const) expect(retryUiState(retryMeta(), { reason: stop, attemptId: "a", account: ACCOUNT }, ACCOUNT).showOpenIssue).toBe(true);
  });

  it("ignores a session stop recorded for an earlier attempt of the same issue", () => {
    expect(retryUiState(retryMeta(), { reason: "permission", attemptId: "older", account: ACCOUNT }, ACCOUNT)).toEqual({ canRetry: true, reason: null, showOpenIssue: true });
  });

  it("ignores a session stop once the platform was reconnected", () => {
    const stop = { reason: "authentication" as const, attemptId: "a", account: ACCOUNT };
    expect(retryUiState(retryMeta(), stop, { token: "t2" })).toEqual({ canRetry: true, reason: null, showOpenIssue: true });
    expect(retryUiState(retryMeta(), stop, undefined).canRetry).toBe(true);
    expect(retryUiState(retryMeta(), stop, ACCOUNT).canRetry).toBe(false);
  });

  it("has a copy key for every reason", () => {
    expect(Object.keys(RETRY_REASON_KEY).sort()).toEqual(["account-changed", "account-unverified", "ambiguous", "authentication", "body-conflict", "legacy", "local-missing", "permission", "remote-missing", "webhook-unsupported"]);
  });
});

describe("pendingFileCount", () => {
  it("counts files whose result is not complete", () => {
    const meta = retryMeta({ checkpoints: [failedCheckpoint("a"), failedCheckpoint("b"), failedCheckpoint("c")] });
    meta.results[2] = { fileId: "c", delivery: "attached", presentation: "complete" };
    expect(pendingFileCount(meta)).toBe(2);
    expect(pendingFileCount(null)).toBe(0);
  });
});

describe("retrySummary", () => {
  const outcome = (patch: Partial<RetryAttachmentsOutcome>): RetryAttachmentsOutcome => ({ status: "partial", attachments: [failedResult("a")], remaining: 1, ...patch });

  it("reports the completed count on complete", () => {
    expect(retrySummary(outcome({ status: "complete", remaining: 0, attachments: [] }), 3)).toEqual({ kind: "complete", n: 3 });
  });
  it("reports how many files failed again on partial", () => {
    expect(retrySummary(outcome({ remaining: 2 }), 3)).toEqual({ kind: "partial", n: 2 });
  });
  // #254: uploads that landed but could not be linked are a body conflict, not "failed again".
  it("names the body conflict when every remaining file only lacks its body link", () => {
    const linkless = failedResult("a", { delivery: "attached", failure: { stage: "body", code: "unknown" } });
    expect(retrySummary(outcome({ reason: "body-conflict", remaining: 1, attachments: [linkless] }), 1)).toEqual({ kind: "conflict" });
    expect(retrySummary(outcome({ reason: "body-conflict", remaining: 0, attachments: [] }), 0)).toEqual({ kind: "partial", n: 0 });
    expect(retrySummary(outcome({ reason: "body-conflict", remaining: 2, attachments: [linkless, failedResult("b")] }), 2)).toEqual({ kind: "partial", n: 2 });
  });
  it("shows a static needs-confirmation instead of a failure count when the result is unknown", () => {
    expect(retrySummary(outcome({ reason: "ambiguous" }), 1)).toEqual({ kind: "needsCheck" });
    expect(retrySummary(outcome({ status: "blocked", reason: "ambiguous" }), 1)).toEqual({ kind: "needsCheck" });
  });
  it("names a stop reason when the run was blocked", () => {
    expect(retrySummary(outcome({ status: "blocked", reason: "account-changed" }), 1)).toEqual({ kind: "blocked", reason: "account-changed" });
    expect(retrySummary(outcome({ status: "blocked", reason: "remote-missing" }), 1)).toEqual({ kind: "blocked", reason: "remote-missing" });
  });
  it("reports a failed local save before anything else", () => {
    expect(retrySummary(outcome({ storageFailed: true, reason: "ambiguous" }), 1)).toEqual({ kind: "storageFailed" });
  });
  it("says nothing when another panel holds the issue", () => {
    expect(retrySummary(outcome({ status: "busy", remaining: 0, attachments: [] }), 1)).toBeNull();
  });
});

describe("sessionStopReason", () => {
  it("keeps only the run-level stops that are not persisted", () => {
    expect(sessionStopReason({ status: "blocked", reason: "permission", attachments: [], remaining: 1 })).toBe("permission");
    expect(sessionStopReason({ status: "blocked", reason: "ambiguous", attachments: [], remaining: 1 })).toBeNull();
    expect(sessionStopReason({ status: "partial", reason: "body-conflict", attachments: [], remaining: 1 })).toBeNull();
    expect(sessionStopReason({ status: "partial", attachments: [], remaining: 1 })).toBeNull();
  });
});
