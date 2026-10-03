import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RetryAttachmentsOutcome, RetryProgressEvent } from "../retryAttachments";

const mocks = vi.hoisted(() => ({ run: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("../retryAttachments", async (original) => ({ ...await original<typeof import("../retryAttachments")>(), retryAttachments: mocks.run }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock("@/i18n", () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }));
import { registerRetryDetail, resetRetrySessions, startAttachmentRetry, useRetrySessions } from "../retrySession";

const session = (id = "issue") => useRetrySessions.getState().sessions[id];
const outcome = (patch: Partial<RetryAttachmentsOutcome>): RetryAttachmentsOutcome => ({ status: "partial", attachments: [], remaining: 1, ...patch });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => { vi.clearAllMocks(); resetRetrySessions(); });

describe("startAttachmentRetry", () => {
  it("runs once for consecutive calls and exposes a running state meanwhile", async () => {
    const gate = deferred<RetryAttachmentsOutcome>();
    mocks.run.mockReturnValue(gate.promise);
    const first = startAttachmentRetry("issue", 2);
    const second = startAttachmentRetry("issue", 2);
    expect(session().running).toBe(true);
    gate.resolve(outcome({ status: "complete", remaining: 0 }));
    await Promise.all([first, second]);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(session().running).toBe(false);
  });

  it("collects per-file progress while running and clears it afterwards", async () => {
    const gate = deferred<RetryAttachmentsOutcome>();
    mocks.run.mockImplementation((_id: string, options: { onProgress: (e: RetryProgressEvent) => void }) => { options.onProgress({ fileId: "f", stage: "upload", state: "running" }); return gate.promise; });
    const done = startAttachmentRetry("issue", 1);
    expect(session().progress).toEqual({ f: { stage: "upload", state: "running" } });
    gate.resolve(outcome({ status: "complete", remaining: 0 }));
    await done;
    expect(session().progress).toEqual({});
  });

  it("toasts success once on complete, even while the detail is open", async () => {
    const unregister = registerRetryDetail("issue");
    mocks.run.mockResolvedValue(outcome({ status: "complete", remaining: 0 }));
    await startAttachmentRetry("issue", 3);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith('recovery.retry.summary.complete:{"n":3}');
    expect(session().summary).toBeNull();
    unregister();
  });

  it("puts a partial result in the detail live region and does not toast it", async () => {
    const unregister = registerRetryDetail("issue");
    mocks.run.mockResolvedValue(outcome({ remaining: 2 }));
    await startAttachmentRetry("issue", 3);
    expect(session().summary).toEqual({ kind: "partial", n: 2 });
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    unregister();
  });

  it("shows exactly one warning toast when the detail is closed", async () => {
    mocks.run.mockResolvedValue(outcome({ remaining: 2 }));
    await startAttachmentRetry("issue", 3);
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    expect(mocks.warning).toHaveBeenCalledWith('recovery.retry.summary.partial:{"n":2}');
    expect(session().summary).toBeNull();
  });

  it("treats a closed detail as closed again after the last registration leaves", async () => {
    const first = registerRetryDetail("issue");
    const second = registerRetryDetail("issue");
    first();
    mocks.run.mockResolvedValue(outcome({ remaining: 1 }));
    await startAttachmentRetry("issue", 1);
    expect(session().summary).not.toBeNull();
    second();
    mocks.run.mockResolvedValue(outcome({ remaining: 1 }));
    await startAttachmentRetry("issue", 1);
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("hides retry for the session after a stop that is not persisted, and keeps nothing for others", async () => {
    mocks.run.mockResolvedValue(outcome({ status: "blocked", reason: "remote-missing" }));
    await startAttachmentRetry("issue", 1);
    expect(session().stopReason).toBe("remote-missing");
    expect(session("other")).toBeUndefined();
  });

  it("clears an earlier stop reason only when a later run is not blocked the same way", async () => {
    mocks.run.mockResolvedValueOnce(outcome({ status: "blocked", reason: "permission" }));
    await startAttachmentRetry("issue", 1);
    mocks.run.mockResolvedValueOnce(outcome({ reason: "body-conflict" }));
    await startAttachmentRetry("issue", 1);
    expect(session().stopReason).toBeNull();
  });

  it("stays silent with no spinner when another panel holds the issue", async () => {
    mocks.run.mockResolvedValue(outcome({ status: "busy", remaining: 0 }));
    await startAttachmentRetry("issue", 1);
    expect(session().running).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(session().summary).toBeNull();
  });

  it("shows a static needs-confirmation for an unknown result", async () => {
    mocks.run.mockResolvedValue(outcome({ reason: "ambiguous" }));
    await startAttachmentRetry("issue", 1);
    expect(session().running).toBe(false);
    expect(mocks.warning).toHaveBeenCalledWith("recovery.retry.summary.needsCheck");
  });

  it("recovers from an unexpected throw with one error toast and no stuck spinner", async () => {
    mocks.run.mockRejectedValue(new Error("boom"));
    await startAttachmentRetry("issue", 1);
    expect(session().running).toBe(false);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it("bumps finishedAt so mounted rows and panels re-read the journal", async () => {
    mocks.run.mockResolvedValue(outcome({}));
    await startAttachmentRetry("issue", 1);
    const first = session().finishedAt;
    mocks.run.mockResolvedValue(outcome({}));
    await startAttachmentRetry("issue", 1);
    expect(session().finishedAt).toBeGreaterThan(first);
  });
});
